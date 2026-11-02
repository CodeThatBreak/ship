import "server-only";

import { db } from "../../db/app";
import { BranchRow, FlowRow, rows } from "../../db/rows";
import { gitHostRegistry } from "../ports/gitHost";
import { flowEngine } from "../flowEngine";
import { reconciler } from "./flowReconciler";
import { templateStore } from "../templates/templateStore";
import { processSingleton } from "../../singleton";
import { worktreeManager } from "./worktreeLifecycle";
import { nextScheduleFireAt } from "./scheduleTrigger";

/**
 * Background poller for active flows: pipeline status + CR (MR/PR) comments.
 * Drives the pipeline-fix loop directly, and the comment-resolve loop via the
 * flow engine's wait-timer tick (each new comment restarts the debounced
 * resolve's quiet period; it fires only once the pipeline gate is clear and
 * the flow has been quiet for the configured delay).
 *
 * Phase 4: the tick also drives the trigger layer — `wait_for: timer` node
 * resumes, and due `schedule` flow triggers (new flow per fire from the
 * template's task/repo binding).
 */
export class FlowPoller {
  private started = false;
  private ticking = false;
  /** Last open-comment count announced per flow — avoids repeating the wait message every tick. */
  private lastCommentCount = new Map<string, number>();

  /** Start polling active flows (idempotent). */
  start(intervalMs = 30_000): void {
    if (this.started) return;
    this.started = true;
    // one-time worktree sweep (fire-and-forget): resume recorded removals,
    // prune, and reconcile workspaces/<flowId> dirs against the flows table
    void worktreeManager.sweepWorktrees().catch((e: unknown) =>
      console.warn(`worktree sweep failed: ${e instanceof Error ? e.message : e}`)
    );
    // one-time global pass over stuck step_merges (plan fan-out Phase 2B):
    // resume or flag merge-backs a restart interrupted — even when nobody has
    // opened a flow page yet
    void reconciler.sweepStuckStepMerges().catch((e: unknown) =>
      console.warn(`step-merge reconcile failed: ${e instanceof Error ? e.message : e}`)
    );
    try {
      flowEngine.reArmWaitingTimers();
    } catch (e: unknown) {
      console.warn(`wait-timer re-arm failed: ${e instanceof Error ? e.message : e}`);
    }
    setTimeout(() => void this.runTick(intervalMs), intervalMs).unref?.();
  }

  private async runTick(intervalMs: number): Promise<void> {
    if (this.ticking) {
      setTimeout(() => void this.runTick(intervalMs), intervalMs).unref?.();
      return;
    }
    this.ticking = true;
    try {
      await this.tick();
    } finally {
      this.ticking = false;
      setTimeout(() => void this.runTick(intervalMs), intervalMs).unref?.();
    }
  }

  private logPhaseError(phase: string, e: unknown): void {
    console.warn(`${phase}: ${e instanceof Error ? e.message : e}`);
  }

  private async tick(): Promise<void> {
    try {
      flowEngine.processWaitTimers();
    } catch (e: unknown) {
      this.logPhaseError("processWaitTimers", e);
    }
    try {
      this.processTemplateSchedules();
    } catch (e: unknown) {
      this.logPhaseError("processTemplateSchedules", e);
    }
    try {
      await this.reconcileActiveFlows();
    } catch (e: unknown) {
      this.logPhaseError("reconcileActiveFlows", e);
    }

    const activeFlowIds = new Set(
      db.all<{ id: string }>(`SELECT id FROM flows WHERE status='active'`).map((r) => r.id),
    );
    const flows = rows.all(
      FlowRow,
      `SELECT * FROM flows WHERE status='active' AND (mr_iid IS NOT NULL OR id IN (SELECT DISTINCT flow_id FROM branches WHERE mr_iid IS NOT NULL))`,
    );
    for (const f of flows) {
      try {
        // Phase 3C: iterate over branches with MRs, then the flow-level MR
        const branchMRs = rows.all(
          BranchRow,
          `SELECT * FROM branches WHERE flow_id=? AND mr_iid IS NOT NULL`,
          f.id,
        );
        if (branchMRs.length > 0) {
          for (const b of branchMRs) {
            if (b.mr_iid == null) continue;
            await this.checkPipeline(f, b.mr_iid, b.name);
            await this.checkDiscussions(f, b.mr_iid, b.name);
          }
        } else if (f.mr_iid) {
          await this.checkPipeline(f, f.mr_iid);
          await this.checkDiscussions(f, f.mr_iid);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        db.emitEvent(f.id, null, "error", `poll: ${msg}`);
      }
    }
    this.pruneCommentCounts(activeFlowIds);
    reconciler.pruneFlowMaps(activeFlowIds);
  }

  /** Re-sync stuck `running` nodes for every active flow (throttled per flow). */
  private async reconcileActiveFlows(): Promise<void> {
    const flows = db.all<{ id: string }>(`SELECT id FROM flows WHERE status='active'`);
    for (const f of flows) {
      try {
        await reconciler.reconcileFlow(f.id);
      } catch (e: unknown) {
        this.logPhaseError(`reconcile ${f.id}`, e);
      }
    }
  }

  /** Drop comment-count dedup keys for flows that are no longer active MR pollers. */
  private pruneCommentCounts(activeFlowIds: Set<string>): void {
    for (const key of [...this.lastCommentCount.keys()]) {
      const flowId = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
      if (!activeFlowIds.has(flowId)) this.lastCommentCount.delete(key);
    }
  }

  /**
   * Fire due `schedule` flow triggers (Phase 4C): one new flow per fire,
   * created + started by the engine from the template's task/repo binding.
   * The next fire time (`schedule_next_at`, armed on first save by
   * TemplateStore) advances by the interval immediately — a failing fire
   * skips this round and the schedule keeps its beat instead of spinning.
   */
  private processTemplateSchedules(): void {
    const templates = db.all<{ id: string; trigger: string | null; schedule_next_at: string | null }>(
      `SELECT id, trigger, schedule_next_at FROM flow_templates WHERE schedule_next_at IS NOT NULL`
    );
    const now = Date.now();
    for (const t of templates) {
      const due = t.schedule_next_at ? Date.parse(t.schedule_next_at) : NaN;
      if (Number.isNaN(due) || now < due) continue;
      const trigger = (() => { try { return JSON.parse(t.trigger ?? "{}") as Record<string, unknown>; } catch { return {}; } })();
      const intervalMin = typeof trigger.interval_min === "number" && trigger.interval_min > 0
        ? trigger.interval_min : 60;
      const nextAt = nextScheduleFireAt(due, now, intervalMin);
      db.run(`UPDATE flow_templates SET schedule_next_at=? WHERE id=?`,
        new Date(nextAt).toISOString(), t.id);
      try {
        // the fire provides nothing (the start contract's defaults apply) —
        // an ad-hoc body would fail the start contract's strict shape check
        flowEngine.startFromTemplate(t.id, {});
      } catch (e: unknown) {
        // no flow instance exists to attach an event to — the dev server log
        // and the template editor (which validates the binding) surface it
        console.error(`schedule trigger for template ${t.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private async checkPipeline(f: FlowRow, mrIid: number, branchName?: string): Promise<void> {
    const repoUrl = f.repo_url ?? "";
    const host = gitHostRegistry.forRepo(repoUrl);
    const cr = await host.getChangeRequest(repoUrl, mrIid).catch(() => null);
    const pipe = cr?.headPipeline;
    if (!pipe) return;
    const prev = branchName
      ? db.get<{ data: string | null }>(
          `SELECT data FROM events WHERE flow_id=? AND type='pipeline' AND json_extract(data,'$.branchName')=? ORDER BY created_at DESC LIMIT 1`,
          f.id,
          branchName,
        )
      : db.get<{ data: string | null }>(
          `SELECT data FROM events WHERE flow_id=? AND type='pipeline' AND (json_extract(data,'$.branchName') IS NULL OR json_extract(data,'$.branchName')='') ORDER BY created_at DESC LIMIT 1`,
          f.id,
        );
    const prevStatus = prev?.data ? JSON.parse(prev.data).status : null;
    if (pipe.status === prevStatus) return;

    // While the gate node is running it owns pipeline reporting (it watches the
    // MR head and emits node-scoped status events) — the poller only steps in
    // to (re)trigger the gate on a fresh failure, so the two writers never
    // fight over the displayed status. The gate node is the one that waits on
    // the pipeline event (role lookup, not the "pipeline" key constant).
    const gateKey = templateStore.waitNodeKey(f.id, "pipeline");
    const gateStatus = gateKey
      ? db.get<{ status: string }>(
          `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, f.id, gateKey
        )?.status
      : undefined;
    if (gateStatus !== "running") {
      // stamped with the owning gate node so the feed routes it (§3.3)
      db.emitEvent(f.id, null, "pipeline", `pipeline ${pipe.status}${branchName ? ` (${branchName})` : ""}`,
        { status: pipe.status, id: pipe.id, branchName: branchName ?? undefined, nodeKey: gateKey ?? undefined });
    }

    if (pipe.status === "failed") {
      // the pipeline gate owns fixes — trigger it (it guards against double-runs)
      flowEngine.triggerPipelineGate(f.id, pipe.id);
    }
  }

  private async checkDiscussions(f: FlowRow, mrIid: number, branchName?: string): Promise<void> {
    const repoUrl = f.repo_url ?? "";
    const comments = await gitHostRegistry
      .forRepo(repoUrl)
      .listComments(repoUrl, mrIid)
      .catch(() => null);
    if (!comments) return;
    const newOpen = flowEngine.ingestComments(f.id, comments, mrIid);
    const openCount = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open' AND mr_iid=?`, f.id, mrIid
    )?.c ?? 0;
    if (newOpen > 0 && openCount > 0) {
      // debounce: each new open comment restarts the quiet period on the
      // debounced resolve wait — the wait-timer tick fires it once the flow
      // has been quiet for the delay and the pipeline gate is clear
      flowEngine.bounceCommentWaits(f.id);
      const countKey = branchName ? `${f.id}:${branchName}` : f.id;
      if (this.lastCommentCount.get(countKey) !== openCount) {
        this.lastCommentCount.set(countKey, openCount);
        const mins = Math.round(flowEngine.resolveDelayMs(f.id) / 60_000);
        db.emitEvent(f.id, null, "lifecycle",
          `${openCount} open comment(s)${branchName ? ` (${branchName})` : ""} — resolve queued for ` +
          `${flowEngine.resolveScheduleClock(f.id) ?? FlowPoller.clockIn(flowEngine.resolveDelayMs(f.id))} ` +
          `(${mins} min quiet, then the pipeline gate)`,
          { nodeKey: templateStore.waitNodeKey(f.id, "comments") ?? undefined });
      }
    }
  }

  /** Fallback clock text ("14:32") when the schedule wasn't readable. */
  private static clockIn(delayMs: number): string {
    return new Date(Date.now() + delayMs).toLocaleTimeString("en-GB",
      { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

export const flowPoller = processSingleton("flowPoller", () => new FlowPoller());
