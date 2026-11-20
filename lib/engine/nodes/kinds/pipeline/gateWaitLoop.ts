import "server-only";

import type { NodeRow } from "../../../../db/rows";
import { gitHostRegistry, type GitHostResolver, type HostJob } from "../../../ports/gitHost";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { FlowCtx, RunOutcome } from "../../shared/nodeSharedExports";
import { configBool, configNumber } from "../../../templates/nodeConfig";
import {
  classifyHeadPipeline,
  shouldDeferPipelineTrigger,
  type HeadPipelineLookup,
} from "./pipelineHead";
import { mrTargetResolver } from "../../shared/mrTargetResolver";
import {
  FIX_PIPELINE_GRACE_MS,
  MAX_FIX_ATTEMPTS_DEFAULT,
  MAX_MANUAL_PLAYS,
  POLL_MS_DEFAULT,
  WAIT_TIMEOUT_MS_DEFAULT,
} from "./constants/waiting";
import { GateProgressSchema, type PipelineInput, type PipelineOutput } from "./schema";
import type { GateProgress } from "./types/gateProgress";
import type { GateFixRunner } from "./gateFixRunner";
import type { GateProgressStore } from "./gateProgressStore";

/** One wait-loop drive: the flow/node context, the recorded input/config, and
 *  the progress snapshot the loop mutates (fresh or resumed) + the def's ONE
 *  outcome publication path. */
export interface GateWaitArgs {
  readonly ctx: FlowCtx;
  readonly node: NodeRow;
  readonly input: PipelineInput;
  readonly config: Record<string, unknown>;
  readonly label: string;
  /** initial progress — a fresh snapshot (run) or the durable one (recover) */
  readonly progress: GateProgress;
  /** the def's ONE outcome publication path (the transition authority's
   *  applyOutcome — status + validated output in one attempt-fenced write) */
  readonly finish: (outcome: RunOutcome) => Promise<RunOutcome>;
}

/** Injectable timing (constructor params) so tests drive the loop in
 *  milliseconds instead of the minute-scale config defaults (step 05). */
export interface GateWaitTiming {
  readonly pollMs?: number;
  readonly timeoutMin?: number;
}

/**
 * GateWaitLoop — the CI gate's resumable polling loop (step 05 decomposition
 * of `pipelineNode`). Wait for the MR's head pipeline to go green; drive
 * manual/blocked pipelines forward; run bounded fix agents on failures. The
 * loop state is the DURABLE {@link GateProgress} (persisted through
 * `GateProgressStore` on every change) — a restart re-enters this loop from
 * the snapshot instead of discarding the wait.
 *
 * Robustness rules: every cycle re-reads the MR's *head* pipeline (a push or
 * retry supersedes the watched id — the gate follows the head instead of
 * flapping); a `manual`/`blocked` pipeline is driven forward by playing its
 * manual jobs via the API (bounded); an already-green head finishes
 * immediately (a retry after a timeout self-heals); the deadline is part of
 * the durable progress — a resume keeps the original window.
 */
export class GateWaitLoop {
  constructor(
    private readonly support: NodeSupport,
    private readonly gitHosts: GitHostResolver = gitHostRegistry,
    private readonly fixRunner: GateFixRunner,
    private readonly progressStore: GateProgressStore,
    /** test seam: milliseconds-scale poll/timeout for the loop's drives */
    private readonly timing: GateWaitTiming = {},
  ) {}

  /**
   * Poll the gate to a terminal outcome; every state change persists through
   * the progress store before the loop continues — a crash between polls
   * loses at most the current poll's observation, never the budget.
   */
  async run(args: GateWaitArgs): Promise<RunOutcome> {
    const { ctx, node, input, config, label, progress, finish } = args;
    const pollMs = this.timing.pollMs ?? configNumber(config, "poll_interval_sec", POLL_MS_DEFAULT / 1000) * 1000;
    const timeoutMin = this.timing.timeoutMin ?? configNumber(config, "gate_timeout_min", WAIT_TIMEOUT_MS_DEFAULT / 60_000);
    const maxFixAttempts = configNumber(config, "max_fix_attempts", MAX_FIX_ATTEMPTS_DEFAULT);
    const { mrIid, mrBranch } = await this.resolveMr(ctx, input.branchName);

    // the deadline belongs to the durable progress: a fresh run arms it once;
    // a resume keeps the original window (and an expired one times out below)
    if (progress.deadlineAt == null) {
      progress.deadlineAt = Date.now() + timeoutMin * 60_000;
      await this.persist(ctx, node, progress);
    }

    let headLookupWarned = false;

    for (;;) {
      // user cancelled / retry started while we were waiting — stop quietly
      const statusNow = await this.support.nodeStatus(node.id);
      if (statusNow !== "running") throw new Error("pipeline wait cancelled");

      // Always re-read the MR head: the watched pipeline can be superseded by a
      // push, a retry, or a pipeline started from the GitLab UI — the head is
      // the only status worth reporting.
      const headLookup = await this.headPipeline(ctx, mrIid);
      if (headLookup.kind === "error" && !headLookupWarned) {
        headLookupWarned = true;
        await this.support.emitLifecycle(
          ctx.flow.id,
          node.id,
          "could not read the MR head pipeline from the git host — retrying without triggering a new pipeline",
        );
      }
      if (headLookup.kind !== "error") headLookupWarned = false;

      const head = headLookup.kind === "ok" ? headLookup.pipe : null;
      const inFixGrace =
        progress.fixWaitStart != null && Date.now() - progress.fixWaitStart < FIX_PIPELINE_GRACE_MS;
      if (progress.fixWaitStart != null && !inFixGrace) progress.fixWaitStart = null;
      if (head && progress.fixWaitStart != null) progress.fixWaitStart = null;

      let pipe = progress.watchedId
        ? await (await this.gitHosts.forRepo(ctx.flow.repoUrl ?? ""))
              .getPipeline(ctx.flow.repoUrl ?? "", progress.watchedId)
              .catch(() => null)
        : null;
      // switch to the head when it's newer/different — stops the watched id
      // from dragging the UI back to a stale/failed state
      if (head && (!pipe || head.id !== pipe.id)) {
        if (pipe && pipe.id !== head.id && !progress.fixedIds.includes(pipe.id)) {
          await this.support.emitLifecycle(
            ctx.flow.id,
            node.id,
            `pipeline #${pipe.id} superseded by head pipeline #${head.id} — watching the head`,
          );
        }
        pipe = head;
        progress.watchedId = head.id;
      }
      // a pipeline we already fixed must not re-enter the fix loop — during the
      // post-fix grace window wait for the push's new head pipeline instead.
      if (pipe != null && progress.fixedIds.includes(pipe.id)) {
        if (inFixGrace || headLookup.kind === "stale") {
          pipe = null;
          progress.watchedId = null;
        }
      }

      if (pipe) {
        progress.watchedId = pipe.id;
        progress.triggerAttempted = false;
        progress.fixWaitStart = null;
        const seen = `${pipe.id}:${pipe.status}`;
        if (seen !== progress.lastSeen) {
          progress.lastSeen = seen;
          await this.support.emit(
            ctx.flow.id,
            node.id,
            "pipeline",
            `pipeline #${pipe.id}: ${pipe.status}`,
            {
              status: pipe.status,
              id: pipe.id,
              branchName: input.branchName ?? undefined,
            },
          );
          await this.persist(ctx, node, progress);
        }

        if (pipe.status === "success") {
          return await finish({
            status: "done",
            output: {
              pipelineId: pipe.id,
              status: pipe.status,
              fixes: progress.fixes,
              branchName: input.branchName ?? undefined,
            } satisfies PipelineOutput,
            event: `pipeline #${pipe.id} green${progress.fixes ? ` after ${progress.fixes} fix run(s)` : ""} — ready for review`,
            reply: `Pipeline #${pipe.id} succeeded${progress.fixes ? ` after ${progress.fixes} fix run(s)` : ""}.`,
          });
        }

        if (pipe.status === "failed") {
          if (progress.fixes >= maxFixAttempts) {
            const msg = `pipeline #${pipe.id} still failing after ${maxFixAttempts} fix run(s) — fix manually or retry`;
            return await finish({
              status: "failed",
              output: {
                pipelineId: pipe.id,
                status: pipe.status,
                fixes: progress.fixes,
                branchName: input.branchName ?? undefined,
              } satisfies PipelineOutput,
              event: msg,
              eventData: { pipelineId: pipe.id, error: msg },
              reply: msg,
            });
          }
          progress.fixes++;
          progress.fixedIds.push(pipe.id);
          await this.persist(ctx, node, progress);
          await this.fixRunner.fix({
            ctx,
            node,
            input,
            pipelineId: pipe.id,
            mrBranch,
            attempt: progress.fixes,
            maxFixAttempts,
            label,
          });
          progress.fixWaitStart = Date.now();
          progress.watchedId = null; // the fix pushed new commits — re-read the head pipeline
          await this.persist(ctx, node, progress);
          continue;
        }

        if (pipe.status === "canceled" || pipe.status === "skipped") {
          const msg = `pipeline #${pipe.id} was ${pipe.status} — retry the pipeline node after starting a new pipeline`;
          return await finish({
            status: "failed",
            output: {
              pipelineId: pipe.id,
              status: pipe.status,
              fixes: progress.fixes,
              branchName: input.branchName ?? undefined,
            } satisfies PipelineOutput,
            event: msg,
            eventData: { pipelineId: pipe.id, error: msg },
            reply: msg,
          });
        }

        // created | waiting_for_resource | preparing | pending | running → keep waiting
        // manual | blocked → drive it forward by playing manual jobs (bounded)
        if (pipe.status === "manual" || pipe.status === "blocked") {
          const key = String(pipe.id);
          const state = progress.manualPlays[key] ?? { plays: 0, warned: false };
          if (configBool(config, "play_manual_jobs", true) && state.plays < MAX_MANUAL_PLAYS) {
            const played = await this.playManualJobs(ctx, node.id, pipe.id);
            state.plays += played;
            if (played === 0 && !state.warned) {
              // nothing playable — some manual jobs need a human in the GitLab UI
              state.warned = true;
              await this.support.emitLifecycle(
                ctx.flow.id,
                node.id,
                `pipeline #${pipe.id} is waiting on manual job(s) — playing them via the API; if none start, run them from GitLab`,
              );
            }
            progress.manualPlays[key] = state;
            await this.persist(ctx, node, progress);
          }
        }
      } else if (
        configBool(config, "auto_trigger_pipeline", true) &&
        !progress.watchedId &&
        !progress.triggerAttempted &&
        !shouldDeferPipelineTrigger(headLookup, inFixGrace)
      ) {
        // no pipeline on the MR head (manual-CI projects don't start one on
        // push) — start it via the API, exactly once per episode. After a fix
        // push this only fires once the grace period elapsed without a new
        // head pipeline appearing.
        progress.triggerAttempted = true;
        await this.persist(ctx, node, progress);
        progress.watchedId = await this.triggerPipeline(ctx, mrIid, mrBranch, node.id);
        await this.persist(ctx, node, progress);
      }

      if (Date.now() > (progress.deadlineAt ?? 0)) {
        // step 05: the timeout terminal is FULLY POPULATED from the durable
        // progress — no pipeline ever seen publishes the explicit
        // `pipelineId: null / status "unknown"` shape, never a bare `{}`
        const seen = progress.lastSeen?.split(":");
        const msg = `timed out waiting for the pipeline on ${mrBranch ?? "the MR"} — retry the pipeline node`;
        return await finish({
          status: "failed",
          output: {
            pipelineId: seen ? Number(seen[0]) : null,
            status: seen ? (seen[1] ?? "unknown") : "unknown",
            fixes: progress.fixes,
            branchName: input.branchName ?? undefined,
            timedOut: true,
          } satisfies PipelineOutput,
          event: msg,
          eventData: { timedOut: true },
          reply: msg,
        });
      }
      // durable wait liveness (step 03): the gate has no run row while it polls —
      // each iteration re-extends the node lease so the reconciler sees it alive
      await this.support.heartbeatLeases(node.id, null);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** A fresh progress snapshot (a run's first drive). */
  static fresh(): GateProgress {
    return GateProgressSchema.parse({
      watchedId: null,
      lastSeen: null,
      fixedIds: [],
      triggerAttempted: false,
      fixWaitStart: null,
      manualPlays: {},
      fixes: 0,
      deadlineAt: null,
    });
  }

  private async persist(ctx: FlowCtx, node: NodeRow, progress: GateProgress): Promise<void> {
    await this.progressStore.save(ctx, node.id, progress);
  }

  /** Resolve the MR (iid + git branch) this gate watches — per-branch or flow-level. */
  private async resolveMr(
    ctx: FlowCtx,
    branchName?: string | null,
  ): Promise<{ mrIid: number; mrBranch: string | null }> {
    return mrTargetResolver.resolve(ctx, branchName);
  }

  /**
   * The MR's current head pipeline, validated against the MR's head sha.
   * This is the single source of truth for "what should the gate be watching":
   * a pipeline for an older sha is stale (a push superseded it) and treated as
   * "no pipeline" so a fresh one gets triggered.
   */
  private async headPipeline(ctx: FlowCtx, mrIid: number): Promise<HeadPipelineLookup> {
    const repoUrl = ctx.flow.repoUrl ?? "";
    const host = await this.gitHosts.forRepo(repoUrl);
    let crFailed = false;
    let cr: Awaited<ReturnType<typeof host.getChangeRequest>> | null = null;
    try {
      cr = await host.getChangeRequest(repoUrl, mrIid);
    } catch {
      crFailed = true;
    }
    const hp = cr?.headPipeline;
    if (crFailed || !hp) {
      return classifyHeadPipeline(cr, crFailed, null, false);
    }
    let pipeFailed = false;
    let pipe: Awaited<ReturnType<typeof host.getPipeline>> | null = null;
    try {
      pipe = await host.getPipeline(repoUrl, hp.id);
    } catch {
      pipeFailed = true;
    }
    return classifyHeadPipeline(cr, false, pipe, pipeFailed);
  }

  /**
   * Trigger a pipeline for the MR via the GitLab API — MR (merged-results)
   * pipeline first, plain branch pipeline as fallback. Returns the new
   * pipeline id, or null when GitLab refuses (CI rules) — then we keep
   * waiting for a human-started pipeline until the deadline.
   */
  private async triggerPipeline(
    ctx: FlowCtx,
    mrIid: number,
    mrBranch: string | null,
    nodeId: string,
  ): Promise<number | null> {
    const repoUrl = ctx.flow.repoUrl ?? "";
    const host = await this.gitHosts.forRepo(repoUrl);
    const errMsg = (e: unknown) =>
      (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await this.support.emitLifecycle(
      ctx.flow.id,
      nodeId,
      `no pipeline found for ${mrBranch ?? "the MR"} — triggering one via the git host API…`,
    );
    try {
      const p = await host.createCRPipeline(repoUrl, mrIid);
      await this.support.emitLifecycle(
        ctx.flow.id,
        nodeId,
        `pipeline #${p.id} triggered (merge-request pipeline)`,
      );
      return p.id;
    } catch (e1) {
      if (!mrBranch) {
        await this.support.emit(
          ctx.flow.id,
          nodeId,
          "error",
          `could not trigger a pipeline: ${errMsg(e1)} — start it manually from the git host`,
        );
        return null;
      }
      try {
        const p = await host.createPipeline(repoUrl, mrBranch);
        await this.support.emitLifecycle(
          ctx.flow.id,
          nodeId,
          `pipeline #${p.id} triggered (branch pipeline)`,
        );
        return p.id;
      } catch (e2) {
        await this.support.emit(
          ctx.flow.id,
          nodeId,
          "error",
          `could not trigger a pipeline via the git host API: ${errMsg(e2)} — start it manually from the git host or check the project's CI rules`,
        );
        return null;
      }
    }
  }

  /**
   * Drive a `manual`/`blocked` pipeline forward: play its pending manual jobs
   * via the API. Returns how many jobs were played this cycle. Failures are
   * logged but non-fatal — the next cycle re-reads the pipeline anyway.
   */
  private async playManualJobs(
    ctx: FlowCtx,
    nodeId: string,
    pipelineId: number,
  ): Promise<number> {
    const repoUrl = ctx.flow.repoUrl ?? "";
    const host = await this.gitHosts.forRepo(repoUrl);
    const jobs = (await host
      .listPipelineJobs(repoUrl, pipelineId)
      .catch(() => [])) as HostJob[];
    const playable = jobs.filter((j) => j.manual);
    let played = 0;
    for (const j of playable) {
      const ok = await host
        .playJob(repoUrl, j.id)
        .then(() => true)
        .catch(() => false);
      if (ok) {
        played++;
        await this.support.emitLifecycle(
          ctx.flow.id,
          nodeId,
          `played manual job "${j.name}" (#${j.id}) on pipeline #${pipelineId}`,
        );
      }
    }
    return played;
  }
}
