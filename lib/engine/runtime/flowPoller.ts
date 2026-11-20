import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../../db/app";
import { FlowRow } from "../../db/rows";
import { gitHostRegistry } from "../ports/gitHost";
import { flowEngine } from "../flowEngine";
import { templateStore } from "../templates/templateStore";
import { worktreeManager } from "./worktreeLifecycle";
import { Reconciler } from "./reconcile/reconciler";
import { WaitStore } from "./waits/waitStore";
import { JobQueue } from "./jobs/jobQueue";
import { WebhookDeliveryHandler } from "./jobs/webhookDeliveryHandler";
import { ScheduleFireHandler } from "./jobs/scheduleFireHandler";
import { CancelHandler } from "./jobs/cancelHandler";
import { MrCreateHandler } from "./jobs/mrCreateHandler";
import { ProcessLock } from "./locks/processLock";
import { JOB_KIND } from "./jobs/constants/jobVocabulary";
import { scheduleFireDedupKey } from "./jobs/utils/jobDedupKeys";
import { TRIGGER_SOURCE } from "./triggers/constants/triggerSources";
import type { JobHandlers } from "./jobs/types/job";

/**
 * FlowPoller — the worker process's tick over active flows (step 03,
 * decisions Q9/Q10): durable wait fires (`nodes.wait_until` + the WaitStore),
 * the template-schedule sweep (enqueues `schedule_fire` jobs — the handler
 * fires and advances `schedule_next_at` in the same transaction as the job's
 * completion), the job sweep (webhook deliveries + schedule fires, claimed
 * with `SKIP LOCKED` leases), the reconcile pass (Reconciler v2 — every
 * non-terminal state, every active flow), then per-MR pipeline + discussion
 * polling via the git host port. New open comments bounce the resolve
 * debounce.
 *
 * The tick refuses to run unless THIS process holds the {@link ProcessLock}
 * (the Postgres advisory lock) — a non-holder logs once and idles; the lock
 * makes "keep one server running" code, not a runbook line.
 *
 * Must never: tick without the lock, compare schedules/leases against
 * app-server time, or start background work from the web process (that is
 * this class's one job, in the worker).
 */
export class FlowPoller {
  private started = false;
  private ticking = false;
  /** Logged the not-the-writer refusal at most once per process. */
  private loggedLockRefusal = false;
  /** Last open-comment count announced per flow — avoids repeating the wait message every tick. */
  private lastCommentCount = new Map<string, number>();

  private readonly jobs = new JobQueue();
  private readonly webhookDeliveries = new WebhookDeliveryHandler();
  private readonly scheduleFires = new ScheduleFireHandler(this.jobs);
  /** step 06 task 4: the sweep's re-claim finalizes an orphaned cancel intent
   *  (step 07: the child-terminal notify rides the engine's effect registry). */
  private readonly cancels = new CancelHandler(this.jobs, flowEngine.effects);
  /** step 06 task 5: the re-claim path's commit-fix run goes through the
   *  engine's delegate (the SDLC chain's loop — the adopt path picks up the
   *  existing MR on a crashed creation). */
  private readonly mrCreates = new MrCreateHandler(this.jobs, (t, attempt, error) =>
    flowEngine.chain.runBuildCommitFix(t.flowId, t.buildKey, t.branch, attempt, t.maxAttempts, error));

  private readonly handlers: JobHandlers = {
    [JOB_KIND.WEBHOOK_DELIVERY]: async (job) => this.webhookDeliveries.handle(job),
    [JOB_KIND.SCHEDULE_FIRE]: async (job) => this.scheduleFires.handle(job),
    [JOB_KIND.CANCEL]: async (job) => this.cancels.handle(job),
    [JOB_KIND.MR_CREATE]: async (job) => this.mrCreates.handle(job),
  };

  constructor(
    private readonly lock: ProcessLock,
    private readonly reconciler: Reconciler = new Reconciler(),
    private readonly waits: WaitStore = flowEngine.waitsStore,
  ) {}

  /** Start the tick loop (idempotent). One-time sweeps first: worktrees and
   *  stuck step merges — resume what a restart interrupted. */
  start(intervalMs = 30_000): void {
    if (this.started) return;
    this.started = true;
    // one-time worktree sweep (fire-and-forget): resume recorded removals,
    // prune, and reconcile workspaces/<flowId> dirs against the flows table
    void worktreeManager.sweepWorktrees().catch((e: unknown) =>
      console.warn(`worktree sweep failed: ${e instanceof Error ? e.message : e}`)
    );
    // one-time global pass over stuck step_merges (plan fan-out Phase 2B):
    // resume or flag merge-backs a restart interrupted — even when nobody
    // has opened a flow page yet
    void this.reconciler.sweepStuckStepMerges().catch((e: unknown) =>
      console.warn(`step-merge reconcile failed: ${e instanceof Error ? e.message : e}`)
    );
    // NOTE (step 03): no wait re-arm pass — waits are durable
    // (`nodes.wait_until`); the first tick's sweep resumes them
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
    // single-writer gate: without the advisory lock this process must not
    // run ANY time-driven engine work — log once and idle
    if (!this.lock.held) {
      if (!this.loggedLockRefusal) {
        this.loggedLockRefusal = true;
        console.warn(
          "[flow-poller] this process does not hold the writer lock — ticks idle " +
            "(another worker owns the poller/reconciler; see /api/health)",
        );
      }
      return;
    }
    this.loggedLockRefusal = false;

    try {
      await this.waits.sweepDueWaits();
    } catch (e: unknown) {
      this.logPhaseError("sweepDueWaits", e);
    }
    try {
      await this.processTemplateSchedules();
    } catch (e: unknown) {
      this.logPhaseError("processTemplateSchedules", e);
    }
    try {
      await this.jobs.sweepDue(this.handlers);
    } catch (e: unknown) {
      this.logPhaseError("jobSweep", e);
    }
    try {
      await this.reconcileActiveFlows();
    } catch (e: unknown) {
      this.logPhaseError("reconcileActiveFlows", e);
    }

    const activeFlowIds = new Set(
      (await db.prisma.flow.findMany({ where: { status: "active" }, select: { id: true } })).map((r) => r.id),
    );
    const flows = await db.prisma.flow.findMany({
      where: {
        status: "active",
        OR: [{ mrIid: { not: null } }, { branches: { some: { mrIid: { not: null } } } }],
      },
      select: {
        id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
        mrBranch: true, repoUrl: true, gitlabProjectId: true,
        executionMode: true, repoId: true, templateId: true, templateGraph: true,
        triggerPayload: true, worktreeDir: true, parentFlowId: true, kind: true,
        createdAt: true, updatedAt: true,
      },
    });
    for (const f of flows) {
      try {
        // Phase 3C: iterate over branches with MRs, then the flow-level MR
        const branchMRs = await db.prisma.branch.findMany({
          where: { flowId: f.id, mrIid: { not: null } },
          select: { mrIid: true, name: true },
        });
        if (branchMRs.length > 0) {
          for (const b of branchMRs) {
            if (b.mrIid == null) continue;
            await this.checkPipeline(f as unknown as FlowRow, b.mrIid, b.name);
            await this.checkDiscussions(f as unknown as FlowRow, b.mrIid, b.name);
          }
        } else if (f.mrIid) {
          await this.checkPipeline(f as unknown as FlowRow, f.mrIid);
          await this.checkDiscussions(f as unknown as FlowRow, f.mrIid);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.emitEvent(f.id, null, "error", `poll: ${msg}`);
      }
    }
    this.pruneCommentCounts(activeFlowIds);
    await this.reconciler.pruneFlowMaps(activeFlowIds);
  }

  /** Reconciler pass over every active flow (idempotent, every tick). */
  private async reconcileActiveFlows(): Promise<void> {
    const flows = await db.prisma.flow.findMany({ where: { status: "active" }, select: { id: true } });
    for (const f of flows) {
      try {
        await this.reconciler.reconcileFlow(f.id);
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
   * Fire due `schedule` flow triggers (Phase 4C) through the job queue: the
   * sweep only ENQUEUES (idempotent — dedup key `template:<id>:<fireAt>`);
   * the claimed job starts the flow and advances `schedule_next_at` in the
   * same transaction as its completion. The old advance-then-fire order
   * silently dropped a fire on a crash between the two writes (step 03).
   */
  private async processTemplateSchedules(): Promise<void> {
    const templates = await db.prisma.flowTemplate.findMany({
      where: { scheduleNextAt: { not: null } },
      select: { id: true, trigger: true, scheduleNextAt: true },
    });
    const now = Date.now();
    for (const t of templates) {
      const due = t.scheduleNextAt ? t.scheduleNextAt.getTime() : NaN;
      if (Number.isNaN(due) || now < due) continue;
      const trigger = (() => { try { return (t.trigger && typeof t.trigger === "object" ? t.trigger : {}) as Record<string, unknown>; } catch { return {}; } })();
      const intervalMin = typeof trigger.interval_min === "number" && trigger.interval_min > 0
        ? trigger.interval_min : 60;
      await this.jobs.enqueue({
        kind: JOB_KIND.SCHEDULE_FIRE,
        dedupKey: scheduleFireDedupKey(t.id, due),
        payload: { templateId: t.id, fireAt: due, intervalMin },
      });
    }
  }

  private async checkPipeline(f: FlowRow, mrIid: number, branchName?: string): Promise<void> {
    const repoUrl = f.repoUrl ?? "";
    const host = await gitHostRegistry.forRepo(repoUrl);
    const cr = await host.getChangeRequest(repoUrl, mrIid).catch(() => null);
    const pipe = cr?.headPipeline;
    if (!pipe) return;
    const prev = branchName
      ? await db.prisma.event.findFirst({
          where: { flowId: f.id, type: "pipeline", data: { path: ["branchName"], equals: branchName } },
          orderBy: { createdAt: "desc" },
          select: { data: true },
        })
      : await db.prisma.event.findFirst({
          where: {
            flowId: f.id, type: "pipeline",
            OR: [{ data: { path: ["branchName"], equals: Prisma.DbNull } }, { data: { path: ["branchName"], equals: "" } }],
          },
          orderBy: { createdAt: "desc" },
          select: { data: true },
        });
    const prevStatus = prev?.data && typeof prev.data === "object"
      ? (prev.data as { status?: string }).status ?? null : null;
    if (pipe.status === prevStatus) return;

    // While the gate node is running it owns pipeline reporting (it watches the
    // MR head and emits node-scoped status events) — the poller only steps in
    // to (re)trigger the gate on a fresh failure, so the two writers never
    // fight over the displayed status. The gate node is the one that waits on
    // the pipeline event (role lookup, not the "pipeline" key constant).
    const gateKey = await templateStore.waitNodeKey(f.id, "pipeline");
    const gateStatus = gateKey
      ? (await db.prisma.node.findFirst({
          where: { flowId: f.id, nodeKey: gateKey },
          select: { status: true },
        }))?.status
      : undefined;
    if (gateStatus !== "running") {
      // stamped with the owning gate node so the feed routes it (§3.3)
      await db.emitEvent(f.id, null, "pipeline", `pipeline ${pipe.status}${branchName ? ` (${branchName})` : ""}`,
        { status: pipe.status, id: pipe.id, branchName: branchName ?? undefined, nodeKey: gateKey ?? undefined });
    }

    if (pipe.status === "failed") {
      // the pipeline gate owns fixes — trigger it; the gateway claim (step 06)
      // is the duplicate fence against the webhook path's identical trigger
      await flowEngine.chain.triggerPipelineGate(f.id, pipe.id, undefined, TRIGGER_SOURCE.POLLER);
    }
  }

  private async checkDiscussions(f: FlowRow, mrIid: number, branchName?: string): Promise<void> {
    const repoUrl = f.repoUrl ?? "";
    const comments = await (
      await gitHostRegistry.forRepo(repoUrl)
    )
      .listComments(repoUrl, mrIid)
      .catch(() => null);
    if (!comments) return;
    const newOpen = await flowEngine.ingest.ingestComments(f.id, comments, mrIid);
    const openCount = await db.prisma.comment.count({
      where: { flowId: f.id, status: "open", mrIid },
    });
    if (newOpen > 0 && openCount > 0) {
      // debounce: each new open comment restarts the quiet period on the
      // debounced resolve wait — the durable wait sweep fires it once the
      // flow has been quiet for the delay and the pipeline gate is clear
      await flowEngine.waitsStore.bounceCommentWaits(f.id);
      const countKey = branchName ? `${f.id}:${branchName}` : f.id;
      if (this.lastCommentCount.get(countKey) !== openCount) {
        this.lastCommentCount.set(countKey, openCount);
        const mins = Math.round((await flowEngine.waitsStore.resolveDelayMs(f.id)) / 60_000);
        await db.emitEvent(f.id, null, "lifecycle",
          `${openCount} open comment(s)${branchName ? ` (${branchName})` : ""} — resolve queued for ` +
          `${await flowEngine.waitsStore.resolveScheduleClock(f.id) ?? FlowPoller.clockIn(await flowEngine.waitsStore.resolveDelayMs(f.id))} ` +
          `(${mins} min quiet, then the pipeline gate)`,
          { nodeKey: (await templateStore.waitNodeKey(f.id, "comments")) ?? undefined });
      }
    }
  }

  /** Fallback clock text ("14:32") when the schedule wasn't readable. */
  private static clockIn(delayMs: number): string {
    return new Date(Date.now() + delayMs).toLocaleTimeString("en-GB",
      { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}
