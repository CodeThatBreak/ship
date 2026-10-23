import { db } from "../db";
import { gitLab } from "../integrations/gitlab";
import { flowEngine } from "./flow";
import { processSingleton } from "../singleton";

/**
 * Background poller for active flows: pipeline status + MR discussions.
 * Drives the pipeline-fix loop directly, and the comment-resolve loop via
 * the flow engine's quiet-period scheduler (new comments push the resolve
 * start out; it fires only once the pipeline gate is clear and the flow has
 * been quiet for the configured delay).
 */
export class FlowPoller {
  private started = false;
  /** Last open-comment count announced per flow — avoids repeating the wait message every tick. */
  private lastCommentCount = new Map<string, number>();

  /** Start polling active flows (idempotent). */
  start(intervalMs = 30_000): void {
    if (this.started) return;
    this.started = true;
    setInterval(() => void this.tick(), intervalMs).unref?.();
  }

  private async tick(): Promise<void> {
    // fire scheduled resolves whose quiet period elapsed (pipeline gate clear)
    flowEngine.processResolveSchedules();

    const flows = db.all<any>(
      `SELECT * FROM flows WHERE status='active' AND (mr_iid IS NOT NULL OR id IN (SELECT DISTINCT flow_id FROM branches WHERE mr_iid IS NOT NULL))`
    );
    for (const f of flows) {
      try {
        // Phase 3C: iterate over branches with MRs, then the flow-level MR
        const branchMRs = db.all<any>(
          `SELECT * FROM branches WHERE flow_id=? AND mr_iid IS NOT NULL`, f.id
        );
        if (branchMRs.length > 0) {
          for (const b of branchMRs) {
            await this.checkPipeline(f, b.mr_iid, b.name);
            await this.checkDiscussions(f, b.mr_iid, b.name);
          }
        } else if (f.mr_iid) {
          await this.checkPipeline(f, f.mr_iid);
          await this.checkDiscussions(f, f.mr_iid);
        }
      } catch (e: any) {
        db.emitEvent(f.id, null, "error", `poll: ${e?.message ?? e}`);
      }
    }
  }

  private async checkPipeline(f: any, mrIid: number, branchName?: string): Promise<void> {
    const mr = await gitLab.getMR(f.repo_url, mrIid).catch(() => null);
    const pipe = mr?.head_pipeline;
    if (!pipe) return;
    const prev = db.get<any>(
      `SELECT data FROM events WHERE flow_id=? AND type='pipeline' ORDER BY created_at DESC LIMIT 1`,
      f.id
    );
    const prevStatus = prev?.data ? JSON.parse(prev.data).status : null;
    if (pipe.status === prevStatus) return;

    // While the gate node is running it owns pipeline reporting (it watches the
    // MR head and emits node-scoped status events) — the poller only steps in
    // to (re)trigger the gate on a fresh failure, so the two writers never
    // fight over the displayed status.
    const gateStatus = db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key='pipeline'`, f.id
    )?.status;
    if (gateStatus !== "running") {
      db.emitEvent(f.id, null, "pipeline", `pipeline ${pipe.status}${branchName ? ` (${branchName})` : ""}`, { status: pipe.status, id: pipe.id, branchName: branchName ?? undefined });
    }

    if (pipe.status === "failed") {
      // the pipeline gate owns fixes — trigger it (it guards against double-runs)
      flowEngine.triggerPipelineGate(f.id, pipe.id);
    }
  }

  private async checkDiscussions(f: any, mrIid: number, branchName?: string): Promise<void> {
    const discussions = await gitLab.listMRDiscussions(f.repo_url, mrIid).catch(() => null);
    if (!discussions) return;
    const newOpen = flowEngine.ingestComments(f.id, discussions);
    const openCount = db.get<any>(
      `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, f.id
    )?.c ?? 0;
    if (newOpen > 0 && openCount > 0) {
      // debounce: (re)start the quiet period — resolve fires from the tick once
      // the flow has been quiet for the configured delay and the pipeline is clear
      flowEngine.scheduleResolve(f.id);
      if (this.lastCommentCount.get(f.id) !== openCount) {
        this.lastCommentCount.set(f.id, openCount);
        const mins = Math.round(flowEngine.resolveDelayMs() / 60_000);
        db.emitEvent(f.id, null, "lifecycle",
          `${openCount} open comment(s)${branchName ? ` (${branchName})` : ""} — resolve queued for ` +
          `${flowEngine.resolveScheduleClock(f.id) ?? FlowPoller.clockIn(flowEngine.resolveDelayMs())} ` +
          `(${mins} min quiet, then the pipeline gate)`);
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
