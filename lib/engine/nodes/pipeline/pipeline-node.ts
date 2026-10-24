import { db } from "../../../db";
import { z } from "zod";
import type { NodeRow } from "../../../db/rows";
import { gitLab } from "../../../integrations/gitlab";
import { prompts } from "../../prompts";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { configBool, configNumber, configString } from "../../node-config";
import { PipelineInput, PipelineOutput } from "./schema";

/** Poll interval while waiting for a pipeline to reach a terminal state. */
const POLL_MS_DEFAULT = 20_000;
/** Give up waiting (node → failed, retryable) after this long. */
const WAIT_TIMEOUT_MS_DEFAULT = 45 * 60_000;
/** Max agent fix attempts before failing the node for manual intervention. */
const MAX_FIX_ATTEMPTS_DEFAULT = 3;
/** Max times we press "play" on manual jobs for one pipeline. */
const MAX_MANUAL_PLAYS = 20;
/**
 * After a fix push, how long to wait for the push's new pipeline to appear on
 * the MR head before triggering one ourselves (manual-CI projects never start
 * one on push). Long enough for GitLab to attach the pipeline (seconds), short
 * enough to keep the loop moving when it never comes.
 */
const FIX_PIPELINE_GRACE_MS = 2 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prompt template used for fix runs (kept as a customizable template in settings). */
const FIX_PROMPT_KEY = "pipeline_fix";

/** GitLab job shape we care about when driving manual jobs. */
interface PipelineJob {
  id: number;
  name: string;
  status: string;
  /** true for jobs a human/agent must start manually */
  manual?: boolean;
  when?: string;
  allow_failure?: boolean;
}

/**
 * The CI gate between code changes and review: ensure a pipeline exists for
 * the MR head (triggering one via the GitLab API when none starts on its own —
 * e.g. manual-CI projects), wait for green, and when it fails run a fix agent
 * (reading failed job logs, pushing to the same branch), looping until the
 * pipeline is green. Review only starts after this node is done.
 *
 * Robustness rules that keep the flow moving and the UI truthful:
 *  - every cycle re-reads the MR's *head* pipeline; when the watched pipeline
 *    is superseded by a newer head (a push, a retry, a manual trigger from
 *    GitLab), the gate switches to the head instead of flapping on a stale id.
 *  - a `manual`/`blocked` pipeline is driven forward by playing its manual
 *    jobs via the API (bounded) rather than sitting until the deadline.
 *  - an already-green head finishes immediately, so a retry after a timeout
 *    self-heals instead of re-waiting.
 */
export class PipelineNode extends NodeDefinition<PipelineInput, PipelineOutput> {
  readonly key = NODE_KEYS.PIPELINE;
  readonly label = "Pipeline";
  readonly promptKeys = [FIX_PROMPT_KEY] as const;
  readonly order = 25;
  readonly edges = [[NODE_KEYS.REVIEW, "next"]] as const;

  readonly inputSchema = PipelineInput;
  readonly outputSchema = PipelineOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    /** user-editable body for fix runs (app-settings pipeline_fix template fallback) */
    fix_prompt_body: z.string().optional(),
    max_fix_attempts: z.number().int().min(1).default(MAX_FIX_ATTEMPTS_DEFAULT),
    poll_interval_sec: z.number().min(1).default(POLL_MS_DEFAULT / 1000),
    /** play a manual/blocked pipeline's manual jobs via the API */
    play_manual_jobs: z.boolean().default(true),
    /** trigger a pipeline via the API when none exists on the MR head */
    auto_trigger_pipeline: z.boolean().default(true),
    gate_timeout_min: z.number().min(1).default(WAIT_TIMEOUT_MS_DEFAULT / 60_000),
  });
  readonly configFields = [
    { key: "fix_prompt_body", label: "Fix-run prompt body", type: "text", help: "User-editable body for CI fix runs; internal contracts re-appended automatically." },
    { key: "max_fix_attempts", label: "Max fix attempts", type: "number", help: "Fix-agent runs per failing pipeline before manual intervention." },
    { key: "poll_interval_sec", label: "Poll interval (s)", type: "number", help: "How often the gate re-reads the pipeline." },
    { key: "play_manual_jobs", label: "Play manual jobs", type: "boolean", help: "Press 'play' on manual jobs via the GitLab API." },
    { key: "auto_trigger_pipeline", label: "Auto-trigger pipeline", type: "boolean", help: "Trigger one via the API when none exists on the MR head." },
    { key: "gate_timeout_min", label: "Gate timeout (min)", type: "number", help: "Give up waiting (retryable failure) after this long." },
  ] as const satisfies readonly ConfigField[];

  /** Resolve the MR (iid + git branch) this gate watches — per-branch or flow-level. */
  private resolveMr(ctx: FlowCtx, branchName?: string | null): { mrIid: number; mrBranch: string | null } {
    if (branchName) {
      const bRow = db.get<{ mr_iid: number | null }>(
        `SELECT mr_iid FROM branches WHERE flow_id=? AND name=?`, ctx.flow.id, branchName);
      if (!bRow?.mr_iid) throw new Error(`no merge request for branch ${branchName} — create it first`);
      return { mrIid: bRow.mr_iid, mrBranch: this.ctxHelper.buildBranch(ctx, branchName) };
    }
    if (!ctx.flow.mr_iid) throw new Error("no merge request yet — approve the build to create one first");
    return { mrIid: ctx.flow.mr_iid, mrBranch: ctx.flow.mr_branch };
  }

  /**
   * The MR's current head pipeline, validated against the MR's head sha.
   * This is the single source of truth for "what should the gate be watching":
   * a pipeline for an older sha is stale (a push superseded it) and treated as
   * "no pipeline" so a fresh one gets triggered.
   */
  private async headPipeline(ctx: FlowCtx, mrIid: number) {
    const mr = await gitLab.getMR(ctx.flow.repo_url ?? "", mrIid).catch(() => null);
    const hp = mr?.head_pipeline;
    if (!mr || !hp) return null;
    const pipe = await gitLab.getPipeline(ctx.flow.repo_url ?? "", hp.id).catch(() => null);
    if (!pipe || (mr.sha && pipe.sha && pipe.sha !== mr.sha)) return null;
    return pipe;
  }

  /**
   * Trigger a pipeline for the MR via the GitLab API — MR (merged-results)
   * pipeline first, plain branch pipeline as fallback. Returns the new
   * pipeline id, or null when GitLab refuses (CI rules) — then we keep
   * waiting for a human-started pipeline until the deadline.
   */
  private async triggerPipeline(ctx: FlowCtx, mrIid: number, mrBranch: string | null, nodeId: string): Promise<number | null> {
    const repoUrl = ctx.flow.repo_url ?? "";
    const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle",
      `no pipeline found for ${mrBranch ?? "the MR"} — triggering one via the GitLab API…`);
    try {
      const p = await gitLab.createMRPipeline(repoUrl, mrIid);
      db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `pipeline #${p.id} triggered (merge-request pipeline)`);
      return p.id;
    } catch (e1) {
      if (!mrBranch) {
        db.emitEvent(ctx.flow.id, nodeId, "error",
          `could not trigger a pipeline: ${errMsg(e1)} — start it manually from GitLab`);
        return null;
      }
      try {
        const p = await gitLab.createPipeline(repoUrl, mrBranch);
        db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `pipeline #${p.id} triggered (branch pipeline)`);
        return p.id;
      } catch (e2) {
        db.emitEvent(ctx.flow.id, nodeId, "error",
          `could not trigger a pipeline via the GitLab API: ${errMsg(e2)} — start it manually from GitLab or check the project's CI rules`);
        return null;
      }
    }
  }

  /**
   * Drive a `manual`/`blocked` pipeline forward: play its pending manual jobs
   * via the API. Returns how many jobs were played this cycle. Failures are
   * logged but non-fatal — the next cycle re-reads the pipeline anyway.
   */
  private async playManualJobs(ctx: FlowCtx, nodeId: string, pipelineId: number): Promise<number> {
    const repoUrl = ctx.flow.repo_url ?? "";
    const jobs = (await gitLab.listPipelineJobs(repoUrl, pipelineId).catch(() => [])) as PipelineJob[];
    // playable = waiting for a human to press "play" (status manual, not when:never)
    const playable = jobs.filter((j) => j.status === "manual" && j.when !== "never");
    let played = 0;
    for (const j of playable) {
      const ok = await gitLab.playJob(repoUrl, j.id).then(() => true).catch(() => false);
      if (ok) {
        played++;
        db.emitEvent(ctx.flow.id, nodeId, "lifecycle",
          `played manual job "${j.name}" (#${j.id}) on pipeline #${pipelineId}`);
      }
    }
    return played;
  }

  async run(ctx: FlowCtx, input: PipelineInput, config: Record<string, unknown>): Promise<RunOutcome> {
    const pollMs = configNumber(config, "poll_interval_sec", POLL_MS_DEFAULT / 1000) * 1000;
    const maxFixAttempts = configNumber(config, "max_fix_attempts", MAX_FIX_ATTEMPTS_DEFAULT);
    const gateTimeoutMin = configNumber(config, "gate_timeout_min", WAIT_TIMEOUT_MS_DEFAULT / 60_000);
    const playManualJobs = configBool(config, "play_manual_jobs", true);
    const { mrIid, mrBranch } = this.resolveMr(ctx, input.branchName);

    // the fix-run prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "fix_prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as PipelineInput;
    }

    const node = this.node(ctx);
    this.support.setNode(node.id, {
      status: "running",
      prompt_override: input.prompt ?? null,
      input: JSON.stringify(input),
    });

    const label = input.branchName ? `pipeline (${input.branchName})` : "pipeline";
    let watchedId = input.pipelineId ?? null;
    let lastSeen: string | null = null; // "<id>:<status>" — emit only on change
    const fixedIds = new Set<number>(); // pipelines we already ran a fix for — superseded
    let triggerAttempted = false; // one API trigger per "no pipeline" episode
    let fixWaitStart: number | null = null; // when we started waiting for a fix's pipeline
    const manualPlays = new Map<number, { plays: number; warned: boolean }>(); // per-pipeline manual-job play state
    let fixes = 0;
    const deadline = Date.now() + gateTimeoutMin * 60_000;

    for (;;) {
      // user cancelled / retry started while we were waiting — stop quietly
      const statusNow = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, node.id)?.status;
      if (statusNow !== "running") throw new Error("pipeline wait cancelled");

      // Always re-read the MR head: the watched pipeline can be superseded by a
      // push, a retry, or a pipeline started from the GitLab UI — the head is
      // the only status worth reporting.
      const head = await this.headPipeline(ctx, mrIid);
      let pipe = watchedId
        ? await gitLab.getPipeline(ctx.flow.repo_url ?? "", watchedId).catch(() => null)
        : null;
      // switch to the head when it's newer/different — stops the watched id
      // from dragging the UI back to a stale/failed state
      if (head && (!pipe || head.id !== pipe.id)) {
        if (pipe && pipe.id !== head.id && !fixedIds.has(pipe.id)) {
          db.emitEvent(ctx.flow.id, node.id, "lifecycle",
            `pipeline #${pipe.id} superseded by head pipeline #${head.id} — watching the head`);
        }
        pipe = head;
        watchedId = head.id;
      }
      // a pipeline we already fixed is superseded by the fix's push — wait for
      // the push's new head pipeline. This is NOT immediately a "no pipeline"
      // state: re-triggering right away would race the pipeline the push is
      // about to start. But manual-CI projects never start one on push, so
      // after a grace period we fall through and trigger one ourselves.
      let awaitingFixPipeline = pipe != null && fixedIds.has(pipe.id);
      if (awaitingFixPipeline) {
        if (fixWaitStart == null) fixWaitStart = Date.now();
        // grace over → treat the stale fixed head as "no pipeline" and trigger
        // below; either way the fixed pipeline itself is never acted on again
        if (Date.now() - fixWaitStart >= FIX_PIPELINE_GRACE_MS) awaitingFixPipeline = false;
        pipe = null;
        watchedId = null;
      }

      if (pipe) {
        watchedId = pipe.id;
        triggerAttempted = false;
        fixWaitStart = null;
        const seen = `${pipe.id}:${pipe.status}`;
        if (seen !== lastSeen) {
          lastSeen = seen;
          db.emitEvent(ctx.flow.id, node.id, "pipeline", `pipeline #${pipe.id}: ${pipe.status}`,
            { status: pipe.status, id: pipe.id, branchName: input.branchName ?? undefined });
        }

        if (pipe.status === "success") {
          const output = this.outputSchema.parse({
            pipelineId: pipe.id, status: pipe.status, fixes,
            branchName: input.branchName ?? undefined,
          });
          this.support.setNode(node.id, { status: "done", output: JSON.stringify(output) });
          db.emitEvent(ctx.flow.id, node.id, "lifecycle",
            `pipeline #${pipe.id} green${fixes ? ` after ${fixes} fix run(s)` : ""} — ready for review`);
          return {
            status: "done",
            output,
            event: `pipeline green (#${pipe.id})`,
            reply: `Pipeline #${pipe.id} succeeded${fixes ? ` after ${fixes} fix run(s)` : ""}.`,
          };
        }

        if (pipe.status === "failed") {
          if (fixes >= maxFixAttempts) {
            const msg = `pipeline #${pipe.id} still failing after ${maxFixAttempts} fix run(s) — fix manually or retry`;
            db.emitEvent(ctx.flow.id, node.id, "error", msg, { pipelineId: pipe.id });
            this.support.setNode(node.id, {
              status: "failed",
              output: JSON.stringify(this.outputSchema.parse({
                pipelineId: pipe.id, status: pipe.status, fixes,
                branchName: input.branchName ?? undefined,
              })),
            });
            throw new Error(msg);
          }
          fixes++;
          fixedIds.add(pipe.id);
          await this.runFix(ctx, node, input, pipe.id, mrBranch, fixes, maxFixAttempts, label);
          watchedId = null; // the fix pushed new commits — re-read the head pipeline
          continue;
        }

        if (pipe.status === "canceled" || pipe.status === "skipped") {
          const msg = `pipeline #${pipe.id} was ${pipe.status} — retry the pipeline node after starting a new pipeline`;
          db.emitEvent(ctx.flow.id, node.id, "error", msg, { pipelineId: pipe.id });
          this.support.setNode(node.id, { status: "failed" });
          throw new Error(msg);
        }

        // created | waiting_for_resource | preparing | pending | running → keep waiting
        // manual | blocked → drive it forward by playing manual jobs (bounded)
        if (pipe.status === "manual" || pipe.status === "blocked") {
          const state = manualPlays.get(pipe.id) ?? { plays: 0, warned: false };
          if (playManualJobs && state.plays < MAX_MANUAL_PLAYS) {
            const played = await this.playManualJobs(ctx, node.id, pipe.id);
            state.plays += played;
            if (played === 0 && !state.warned) {
              // nothing playable — some manual jobs need a human in the GitLab UI
              state.warned = true;
              db.emitEvent(ctx.flow.id, node.id, "lifecycle",
                `pipeline #${pipe.id} is waiting on manual job(s) — playing them via the API; if none start, run them from GitLab`);
            }
            manualPlays.set(pipe.id, state);
          }
        }
      } else if (
        configBool(config, "auto_trigger_pipeline", true) &&
        !watchedId && !triggerAttempted && !awaitingFixPipeline
      ) {
        // no pipeline on the MR head (manual-CI projects don't start one on
        // push) — start it via the API, exactly once per episode. After a fix
        // push this only fires once the grace period elapsed without a new
        // head pipeline appearing.
        triggerAttempted = true;
        watchedId = await this.triggerPipeline(ctx, mrIid, mrBranch, node.id);
      }

      if (Date.now() > deadline) {
        // Persist the last known pipeline id/status in the output so the UI and
        // a retry start from the truth — a retry re-reads the head and finishes
        // immediately when it has since gone green.
        const last = lastSeen?.split(":");
        const patch: Record<string, unknown> = { status: "failed" };
        if (last) {
          patch.output = JSON.stringify(this.outputSchema.parse({
            pipelineId: Number(last[0]), status: last[1], fixes,
            branchName: input.branchName ?? undefined,
          }));
        }
        this.support.setNode(node.id, patch);
        throw new Error(`timed out waiting for the pipeline on ${mrBranch ?? "the MR"} — retry the pipeline node`);
      }
      // server-side wait liveness: the reconciler treats a fresh updated_at on a
      // running pipeline node as "alive" (it has no agent run row while waiting)
      this.support.setNode(node.id, { status: "running" });
      await sleep(pollMs);
    }
  }

  /** Run the fix agent against a failed pipeline: fetch logs, prompt, execute. */
  private async runFix(
    ctx: FlowCtx,
    node: NodeRow,
    input: PipelineInput,
    pipelineId: number,
    mrBranch: string | null,
    attempt: number,
    maxFixAttempts: number,
    label: string,
  ): Promise<void> {
    const jobs = await gitLab.listPipelineJobs(ctx.flow.repo_url ?? "", pipelineId);
    const failed = jobs.filter((j: { status: string }) => j.status === "failed");
    let logs = "";
    for (const j of failed.slice(0, 3)) {
      const trace = await gitLab.getJobTrace(ctx.flow.repo_url ?? "", j.id).catch(() => "");
      logs += `\n\n===== job ${j.name} (#${j.id}) =====\n${trace.slice(-8000)}`;
    }

    const mode = this.ctxHelper.execMode(ctx);
    const instructions = mode === "local" ? `Start by checking out branch ${mrBranch}.` : "";
    const guidance = input.guidance ? `Developer guidance: ${input.guidance}` : "";

    const prompt = (input.prompt
      ? input.promptIsBody
        ? `${input.prompt}\n\n${prompts.internalSuffix(FIX_PROMPT_KEY,
            { branch: mrBranch ?? "", pipelineId: String(pipelineId) },
            { instructions, guidance, logs: logs || "(logs unavailable)" })}`
        : input.prompt
      : prompts.resolve(FIX_PROMPT_KEY,
          { branch: mrBranch ?? "", pipelineId: String(pipelineId) },
          { instructions, guidance, logs: logs || "(logs unavailable)" },
        )
    ).split("\n").filter(Boolean).join("\n");

    db.emitEvent(ctx.flow.id, node.id, "lifecycle",
      `pipeline #${pipelineId} failed — fix run ${attempt}/${maxFixAttempts}`,
      { pipelineId, attempt });

    const result = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: "agent",
          name: `${label} fix ${ctx.task.key}`,
          startingRef: mrBranch ?? undefined,
          model: input.model,
        }),
      `${label} fix`,
    );

    this.support.saveArtifact(node.id, ctx.flow.id, "fix", result.result ?? "", { pipelineId, attempt });
    db.emitEvent(ctx.flow.id, node.id, "lifecycle",
      `fix run ${attempt} pushed to ${mrBranch} — waiting for the new pipeline`, { pipelineId });
  }

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    if (!ctx.flow.mr_iid) return "No merge request yet — the pipeline gate runs automatically after the build is approved and the MR is created.";
    const node = this.node(ctx);
    const prevInput = (node.input ?? {}) as PipelineInput;
    const outcome = await this.run(ctx, this.inputSchema.parse({
      ...prevInput,
      guidance: content,
      prompt: null,
      promptIsBody: false,
    }), this.nodeConfig(ctx));
    return outcome.reply;
  }

  /**
   * A pipeline wait interrupted mid-run can't be resumed (the fix runs are
   * non-idempotent) — fail so the user retries; the retry re-reads the current
   * head pipeline, so already-green pipelines finish immediately.
   */
  async recover(): Promise<boolean> {
    return false;
  }
}
