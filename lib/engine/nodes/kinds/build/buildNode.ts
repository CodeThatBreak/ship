import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import { prompts } from "../../../prompts/promptLibrary";
import { agentRunner, type AgentRunner } from "../../../harness/harnessExports";
import { AgentRunNode, flowCtxHelper, nodeRoles, type FlowContextHelper, type FlowCtx, type NodePromptPreview, type NodeTriggerRun, type RunOutcome } from "../../shared/nodeSharedExports";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { ConfigField } from "../../../templates/nodeConfig";
import { DEFAULT_MCP_SOURCES, mcpSourcesSchema } from "../../../templates/schemas/mcpSources";
import { configString, mcpSourcesOf, mcpSourceConfigFields } from "../../../templates/nodeConfig";
import type { NodeSupport } from "../../shared/nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { BuildRunSupport } from "./buildRunSupport";
import { branchStore } from "./branchStore";
import { BuildTriggerPlanner } from "./buildTriggerPlanner";
import { BuildPromptAssembler } from "./buildPromptAssembler";
import { BuildFinalizer } from "./buildFinalizer";
import { AGENT_TOOL_SETS } from "../../../agentTools/constants/agentTools";
import { BuildConsumes, BuildInput, BuildOutput } from "./schema";

/**
 * The build def (the SDLC chain's code stage): triggerRuns materializes the
 * approved plan (whole / multi-branch sequential).
 *
 * Composition (engine overhaul §12): the def is a thin orchestrator over its
 * collaborators — `BuildTriggerPlanner` (engine-trigger materialization:
 * approved-plan read, multi-branch decomposition), `BuildPromptAssembler`
 * (the ONE run/preview prompt assembly path) and `BuildFinalizer` (the build
 * terminal: checklist progress, branch row, diff artifact). The def itself
 * keeps the declarative metadata and the run/refine/chat/recover orchestration.
 */
export class BuildNode extends AgentRunNode<BuildInput, BuildOutput> {
  readonly key = NODE_KEYS.BUILD;
  readonly label = "Build";
  /** §T4: chat messages refine the build — the node rerun-with-feedback recipe.
   *  The first turn before a run IS the build prompt (composer-as-prompt, plan's
   *  precedent): it carries the prompt body against the approved plan. */
  override readonly capabilities: NodeCapabilities = {
    panelTitle: "Code changes",
    refinable: true,
    promptNode: NODE_KEYS.BUILD,
    startLabel: "Start build",
  };
  /** Engine-dispatch metadata (§T3): build approval is a built-in flow action
   *  (the CR-creation chain), and the build kind occupies the chain's build role. */
  override readonly builtinApproval = true;
  override readonly chainRole = NODE_KEYS.BUILD;
  readonly promptKeys: readonly string[] = [NODE_KEYS.BUILD, "build_refine"];
  override readonly promptSections: readonly string[] = [NODE_KEYS.BUILD];
  readonly order = 20;
  override readonly edges = [[NODE_KEYS.PIPELINE, "next"]] as const;

  /** Composed run machinery shared with the step child (§T6) — built from
   *  this def's own injected services so a test stub rides the same seam. */
  protected readonly buildRun: BuildRunSupport;
  private readonly triggerPlanner: BuildTriggerPlanner;
  private readonly promptAssembler: BuildPromptAssembler;
  private readonly finisher: BuildFinalizer;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    super(support, runner, ctxHelper);
    this.buildRun = new BuildRunSupport(support, ctxHelper);
    this.triggerPlanner = new BuildTriggerPlanner(support);
    this.promptAssembler = new BuildPromptAssembler(this.buildRun, ctxHelper);
    this.finisher = new BuildFinalizer(support, this.buildRun, BuildOutput, this.key);
  }

  readonly inputSchema = BuildInput;
  readonly outputSchema = BuildOutput;
  override readonly consumes = BuildConsumes;
  /** validation-only: the build-progress fence has no feedback turn — a
   *  missing/unparseable report with pending steps fails the node (step 05) */
  override readonly retryBudget = 0;

  /** Step 08 (Invariant 10): the build agent gets the full toolset. */
  override agentTools() {
    return [...AGENT_TOOL_SETS.build];
  }

  /** Typed config knobs (defaults = today's behavior). */
  override readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** custom branch naming, e.g. "bugfix/{ticket}-{id}"; empty = built-in pattern */
    branch_pattern: z.string().default(""),
    /** commit-fix agent attempts when the push is rejected during MR creation (engine-consumed) */
    max_commit_fix_attempts: z.number().int().min(1).default(2),
    /** ambient MCP servers for build/refine agent runs — defaults to ALL sources enabled */
    mcp_sources: mcpSourcesSchema.default(DEFAULT_MCP_SOURCES),
  });
  override readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body for build runs." },
    { key: "branch_pattern", label: "Branch pattern", type: "string", help: "Tokens: {prefix} {slug} {ticket} {id} {suffix}. Empty = built-in bugfix/feature pattern." },
    { key: "max_commit_fix_attempts", label: "Max commit-fix attempts", type: "number", help: "Commit-fix agent runs when the push is rejected while creating the MR." },
    ...mcpSourceConfigFields,
  ] as const satisfies readonly ConfigField[];

  /**
   * Engine-triggered runs (the plan → build edge activation when the plan is
   * approved): the approved plan + branch decomposition + the plan run's
   * model, as sequential multi-branch runs. {@link BuildTriggerPlanner}
   * owns the materialization.
   */
  override async triggerRuns(ctx: FlowCtx): Promise<NodeTriggerRun[]> {
    return this.triggerPlanner.triggerRuns(ctx);
  }

  async run(ctx: FlowCtx, input: BuildInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // Chat refine on an existing build agent is a different path
    if (input.feedback) return this.refine(ctx, input);

    const node = await this.node(ctx);
    const plan = input.plan;
    if (!plan) throw new Error("plan is required for a build");

    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body } as BuildInput;
    }

    const mode = this.ctxHelper.execMode(ctx);
    const branchSuffix = input.branchInfo?.name;
    const branch = this.buildRun.branchName(ctx, config, branchSuffix);
    const label = input.branchInfo ? `build (${input.branchInfo.name})` : "build";

    const { worktree, setupNote } = await this.buildRun.worktree(ctx, branch, node.id);

    const prompt = (await this.promptAssembler.assemble(ctx, config, {
      plan,
      branchInfo: input.branchInfo,
      promptOverride: input.prompt,
      promptIsBody: input.promptIsBody ?? false,
      setupNote,
    })).assembly.final;

    return this.execute(ctx, {
      input: { ...input, prompt, branch: input.branchInfo?.name ?? null },
      prompt,
      agent: {
        mode: "agent",
        name: input.branchInfo ? `build ${ctx.task.key} (${input.branchInfo.name})` : `build ${ctx.task.key}`,
        autoCreatePR: false,
        // worktree mode: the branch already exists (created with the worktree);
        // cloud mode: the agent branches off the default ref itself
        startingRef: mode === "local" ? branch : (ctx.repo?.defaultBranch ?? "main"),
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources: mcpSourcesOf(config),
      },
      label,
      finalize: (result, meta) => this.finisher.finalize(ctx, result, branch, input.branchInfo, node.id, meta.runRowId),
    });
  }

  /** Chat-driven changes: follow up on the build agent, regenerate the diff. */
  private async refine(ctx: FlowCtx, input: BuildInput): Promise<RunOutcome> {
    const feedback = input.feedback;
    if (!feedback) throw new Error("feedback is required for a build refine");
    const node = await this.node(ctx);
    if (!node.agentId) {
      // no build agent yet — a full build with the latest plan + note. Step 05:
      // WITHOUT a plan this used to build from an empty string (the
      // `(plan?.content ?? "")` silent default) — refuse loudly instead.
      const plan = await this.support.latestArtifact(ctx.flow.id, "plan");
      if (!plan?.content) {
        throw new Error("build refine has no build agent to follow up on and no approved plan to build from — start a build first");
      }
      return this.run(ctx, this.inputSchema.parse({
        plan: plan.content + `\n\nDeveloper note: ${feedback}`,
        model: input.model ?? null,
      }), await this.nodeConfig(ctx));
    }

    let prompt = prompts.resolve("build_refine", {}, { feedback }, input.prompt);
    const config = await this.nodeConfig(ctx);
    const gitBranch = input.branchInfo
      ? ((await branchStore.gitBranch(ctx.flow.id, input.branchInfo.name))
          ?? this.buildRun.branchName(ctx, config, input.branchInfo.name))
      : this.buildRun.flowBranch(ctx);
    const { worktree, setupNote } = await this.buildRun.worktree(ctx, gitBranch, node.id);
    prompt += this.buildRun.setupAdvisory(setupNote);
    const outcome = await this.execute(ctx, {
      input: { feedback, prompt: input.prompt ?? null, model: input.model ?? null },
      prompt,
      agent: {
        mode: "agent",
        name: `build refine ${ctx.task.key}`,
        followUpOn: node.agentId,
        startingRef: gitBranch,
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources: mcpSourcesOf(config),
      },
      label: "build refine",
      finalize: async (result) => {
        const branch = input.branchInfo
          ? ((await branchStore.gitBranch(ctx.flow.id, input.branchInfo.name))
              ?? (await this.buildRun.refineBranch(ctx, result)))
          : (await this.buildRun.refineBranch(ctx, result));
        const art = await this.buildRun.diffArtifact(ctx, node.id, branch ?? "", {
          noDiffContent: result.result ?? "",
          extraMeta: { feedback },
        });
        return {
          status: "awaiting_approval" as const,
          output: this.outputSchema.parse({ branch: branch ?? "", latestArtifact: art.id }),
          event: `build updated per feedback; new diff ready`,
          reply: result.result ?? "Done.",
        };
      },
    });
    return outcome;
  }

  /**
   * The first turn on a never-run node IS the build prompt: the composer's
   * message is the build's prompt body, with the approved plan as the run's
   * input (the composer-as-prompt shape plan introduced — the composer is
   * prefilled with build's prompt body, which already renders the plan).
   * Turns after a run are the `feedback` refine.
   */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (this.isFirstTurn(await this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        this.inputSchema.parse({
          plan: (await this.triggerPlanner.approvedPlan(ctx)).content,
          prompt: content,
          promptIsBody: true,
          model: model ?? null,
        }),
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    return super.chat(ctx, content, model);
  }

  /**
   * Live prompt preview: same branch/instructions/checklist path as `run`
   * (the ONE {@link BuildPromptAssembler} assembly — CR-004). Worktree setup
   * notes appear only after a worktree exists (null beforehand).
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null): Promise<NodePromptPreview | null> {
    const config = await nodeRoles.previewConfig(this, node);
    const planRow = await this.support.latestArtifact(ctx.flow.id, "plan");
    const configBody = configString(config, "prompt_body") ?? null;
    const { configBody: resolvedBody, assembly } = await this.promptAssembler.assemble(ctx, config, {
      plan: planRow?.content ?? null,
      branchInfo: null,
      promptOverride: configBody,
      setupNote: null,
    });
    return {
      templateKey: NODE_KEYS.BUILD,
      configBody: resolvedBody,
      assembly,
    };
  }

  /**
   * Complete a build whose agent run was orphaned (server restarted mid-run)
   * but left commits on the build branch. Non-finished recorded runs are
   * `manual` (the fixed recovery ABI — never a bare false).
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the build run ended with ${result.status} — the branch state is re-derived on retry` };
    }
    const branch = this.buildRun.reportedBranch(result) ?? this.buildRun.flowBranch(ctx);
    await this.recoverBranch(ctx, node, branch, note);
    return { kind: "recovered" };
  }

  /** Recover an orphaned build from a known branch (reconcile calls this too). */
  async recoverBranch(ctx: FlowCtx, node: NodeRow, branch: string, note: string): Promise<void> {
    if (node.status !== "running") return;
    await this.support.setFlowBranch(ctx.flow.id, branch);
    ctx.flow.mrBranch = branch;
    const art = await this.buildRun.diffArtifact(ctx, node.id, branch, {
      noDiffContent: "(diff unavailable — fetch from GitLab)",
      extraMeta: { recovered: true },
    });
    await this.applyOutcome(ctx, {
      status: "awaiting_approval",
      output: this.outputSchema.parse({ branch, latestArtifact: art.id }),
      event: `build recovered on branch ${branch}; diff ready for review`,
      eventData: { stat: art.stat, recovered: true },
      reply: "",
    }, { note });
  }
}
