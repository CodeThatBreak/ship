import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import { gitHostRegistry, type GitHostResolver } from "../../../ports/gitHost";
import { prompts } from "../../../prompts/promptLibrary";
import { AgentRunNode, nodeRoles, nodeSupport, type FlowCtx, type NodePromptPreview, type PromptPreviewParams, type RunOutcome } from "../../shared/nodeSharedExports";
import { flowCtxHelper } from "../../shared/runContext";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { AgentRunner } from "../../../harness/harnessExports";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { ConfigField } from "../../../templates/nodeConfig";
import { configString } from "../../../templates/nodeConfig";
import { PipelineConsumes, PipelineInput, PipelineOutput } from "./schema";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import type { GateProgress } from "./types/gateProgress";
import { GateFixRunner } from "./gateFixRunner";
import { GateProgressStore } from "./gateProgressStore";
import { GateWaitLoop } from "./gateWaitLoop";
import { FIX_PROMPT_KEY, MAX_FIX_ATTEMPTS_DEFAULT, POLL_MS_DEFAULT, WAIT_TIMEOUT_MS_DEFAULT } from "./constants/waiting";

/**
 * PipelineNode — the CI gate between code changes and review (the thin def
 * half of the step-05 decomposition): triggerRuns-less; `run` folds the
 * prompt-body knob, records the input, and drives the {@link GateWaitLoop}
 * with a fresh progress snapshot; `recover` re-enters the SAME loop from the
 * durable {@link GateProgress} snapshot (step 05, Invariant 9) instead of
 * failing the node. The loop owns the polling/supersede/manual-play rules;
 * {@link GateFixRunner} owns the fix-agent runs; {@link GateProgressStore}
 * owns the durable state.
 */
export class PipelineNode extends AgentRunNode<
  PipelineInput,
  PipelineOutput
> {
  readonly key = NODE_KEYS.PIPELINE;
  readonly label = "Pipeline";
  /** §T4: chat messages ride the gate rerun as developer guidance; the first
   *  turn on a never-run gate carries the fix-run prompt body (composer-as-
   *  prompt, plan's precedent). */
  override readonly capabilities: NodeCapabilities = {
    panelTitle: "CI pipeline",
    refinable: true,
    promptNode: NODE_KEYS.PIPELINE,
    startLabel: "Run pipeline",
  };
  /** Engine-dispatch metadata (§T3): consumers (the CI gate) wait on the
   *  pipeline event source — gate lookups route through this, not a literal. */
  override readonly waitForKind = NODE_KEYS.PIPELINE;
  readonly promptKeys = [FIX_PROMPT_KEY] as const;
  override readonly promptSections = [FIX_PROMPT_KEY] as const;
  readonly order = 25;
  override readonly edges = [[NODE_KEYS.REVIEW, "next"]] as const;

  readonly inputSchema = PipelineInput;
  readonly outputSchema = PipelineOutput;
  override readonly consumes = PipelineConsumes;

  /** Typed config knobs (defaults = today's behavior). */
  override readonly configSchema = z.object({
    /** user-editable body for fix runs (app-settings pipeline_fix template fallback) */
    fix_prompt_body: z.string().optional(),
    max_fix_attempts: z.number().int().min(1).default(MAX_FIX_ATTEMPTS_DEFAULT),
    poll_interval_sec: z
      .number()
      .min(1)
      .default(POLL_MS_DEFAULT / 1000),
    /** play a manual/blocked pipeline's manual jobs via the API */
    play_manual_jobs: z.boolean().default(true),
    /** trigger a pipeline via the API when none exists on the MR head */
    auto_trigger_pipeline: z.boolean().default(true),
    gate_timeout_min: z
      .number()
      .min(1)
      .default(WAIT_TIMEOUT_MS_DEFAULT / 60_000),
  });
  override readonly configFields = [
    {
      key: "fix_prompt_body",
      label: "Fix-run prompt body",
      type: "text",
      help: "User-editable body for CI fix runs; internal contracts re-appended automatically.",
    },
    {
      key: "max_fix_attempts",
      label: "Max fix attempts",
      type: "number",
      help: "Fix-agent runs per failing pipeline before manual intervention.",
    },
    {
      key: "poll_interval_sec",
      label: "Poll interval (s)",
      type: "number",
      help: "How often the gate re-reads the pipeline.",
    },
    {
      key: "play_manual_jobs",
      label: "Play manual jobs",
      type: "boolean",
      help: "Press 'play' on manual jobs via the git host API.",
    },
    {
      key: "auto_trigger_pipeline",
      label: "Auto-trigger pipeline",
      type: "boolean",
      help: "Trigger one via the API when none exists on the MR head.",
    },
    {
      key: "gate_timeout_min",
      label: "Gate timeout (min)",
      type: "number",
      help: "Give up waiting (retryable failure) after this long.",
    },
  ] as const satisfies readonly ConfigField[];

  private readonly waitLoop: GateWaitLoop;
  private readonly progressStore: GateProgressStore;

  constructor(
    support: NodeSupport = nodeSupport,
    runner?: AgentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
    gitHosts: GitHostResolver = gitHostRegistry,
    /** test seam: milliseconds-scale poll/timeout for the wait loop (step 05) */
    timing: { pollMs?: number; timeoutMin?: number } = {},
  ) {
    super(support, runner, ctxHelper);
    this.progressStore = new GateProgressStore(support);
    this.waitLoop = new GateWaitLoop(
      support,
      gitHosts,
      new GateFixRunner(support, runner, ctxHelper, gitHosts),
      this.progressStore,
      timing,
    );
  }

  /**
   * Live prompt preview (verbatim from the route's former pipeline case): the
   * fix body knob or default with the run's guidance/instructions vars. The
   * pipeline-id/branch/logs vars are run data (the failed pipeline is known
   * only at run time) — filled at Phase-2 preview work (I5).
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    const branch = ctx.flow.mrBranch ?? this.ctxHelper.buildBranch(ctx);
    const mode = this.ctxHelper.execMode(ctx);
    const configBody = configString(await nodeRoles.previewConfig(this, node), "fix_prompt_body") ?? null;
    const asm = prompts.assemblePrompt(
      FIX_PROMPT_KEY,
      {},
      {
        guidance: params.instructions ? `Developer guidance: ${params.instructions}` : "",
        instructions: mode === "local" ? `Start by checking out branch ${branch}.` : "",
      },
      { body: configBody },
    );
    return { templateKey: FIX_PROMPT_KEY, configBody, assembly: asm };
  }

  async run(
    ctx: FlowCtx,
    input: PipelineInput,
    config: Record<string, unknown>,
  ): Promise<RunOutcome> {
    // the fix-run prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "fix_prompt_body");
      if (body)
        input = { ...input, prompt: body, promptIsBody: true } as PipelineInput;
    }

    const node = await this.node(ctx);
    await this.markRunning(ctx, input as unknown as Record<string, unknown>);

    const label = input.branchName
      ? `pipeline (${input.branchName})`
      : "pipeline";
    return this.waitLoop.run({
      ctx,
      node,
      input,
      config,
      label,
      progress: GateWaitLoop.fresh(),
      finish: (outcome) => this.applyOutcome(ctx, outcome),
    });
  }

  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (!ctx.flow.mrIid)
      return "No merge request yet — the pipeline gate runs automatically after the build is approved and the MR is created.";
    const node = await this.node(ctx);
    // The first turn on a never-run gate treats the message as the fix-run
    // prompt body (promptIsBody — the documented override the modal and the
    // action route recorded); turns after a run stay guidance.
    if (this.isFirstTurn(node)) {
      const outcome = await this.run(
        ctx,
        this.inputSchema.parse({
          prompt: content,
          promptIsBody: true,
          model: model ?? null,
        }),
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    const prevInput = (node.input ?? {}) as PipelineInput;
    const outcome = await this.run(
      ctx,
      this.inputSchema.parse({
        ...prevInput,
        guidance: content,
        prompt: null,
        promptIsBody: false,
        model: model ?? null,
      }),
      await this.nodeConfig(ctx),
    );
    return outcome.reply;
  }

  /**
   * Restart recovery re-enters the wait from the durable progress (step 05,
   * Invariant 9): the loop resumes with its persisted budget (`fixes`,
   * `manualPlays`, `lastSeen`) and ORIGINAL deadline, and publishes the
   * terminal through the one outcome path. No persisted progress (or an
   * unparseable one) is `manual` with the reason — never a fabricated fresh
   * wait that would re-spend the fix budget.
   *
   * Cadence note: the resumed loop runs to its terminal inside this call (the
   * lease heartbeat inside the loop keeps the reconciler from re-recovering a
   * live gate); the reconciler pass therefore takes as long as the remaining
   * wait — flagged for the step-06 concurrency pass.
   */
  async recover(ctx: FlowCtx, node: NodeRow, _result: AgentRunResult, note: string): Promise<RecoveryResult> {
    void _result;
    let progress: GateProgress;
    try {
      const loaded = await this.progressStore.load(ctx);
      if (!loaded) {
        return { kind: "manual", reason: "no durable gate progress to resume — retry the node (an already-green head pipeline finishes immediately)" };
      }
      progress = loaded;
    } catch (e: unknown) {
      return { kind: "manual", reason: `the persisted gate progress is unparseable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const input = this.inputSchema.parse(node.input ?? {});
    const config = await this.nodeConfig(ctx);
    const label = input.branchName ? `pipeline (${input.branchName})` : "pipeline";
    await this.waitLoop.run({
      ctx,
      node,
      input,
      config,
      label,
      progress,
      finish: (o) => this.applyOutcome(ctx, o, { note: `recovered: ${note}` }),
    });
    return { kind: "recovered" };
  }
}
