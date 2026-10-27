import { z } from "zod";
import { AgentRunNode, agentRunner, flowCtxHelper, type AgentRunner, type FlowContextHelper } from "../base";
import type { FlowCtx, NodeTriggerRun, RunOutcome } from "../base";
import { nodeSupport, type NodeSupport } from "../base/node-support";
import type { FlowRow, NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agent-runner";
import { prompts } from "../../prompts/prompt-library";
import { DEFAULT_FANOUT_OUTPUT, type MergeBackArgs, type MergeBackResult, type NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import { DEFAULT_MCP_SOURCES, mcpSourceConfigFields, mcpSourcesOf, mcpSourcesSchema } from "../../templates/node-config";
import { mergeArena } from "../../runtime/fanout/merge-arena";
import { BuildRunSupport } from "./build-run-support";
import { BuildInput, BuildOutput } from "./schema";

// ── the fan-out step child of build (`step_build`, Phase 1C) ─────────────────
// ONE plan step built by its own child flow on its own branch.
//
// Prompt: the base build frame + a STEP section (this step's title/detail/
// files, "implement exactly this step") + the CONTEXT PACK (sibling steps'
// titles/files/statuses with the "don't touch their files" advisory) + the
// FULL parent plan so the agent understands where its step sits. There is NO
// `build-progress` block — steps turn green only on merge (never on agent
// claim), keeping the `plan_steps.status` semantics unchanged.
//
// Session lineage decision (recorded per plan §4): Phase 1 runs children from
// FRESH sessions seeded by the context pack. The plan's "first child follows
// up on the parent build's agent" alternative is deliberately deferred: in
// steps mode the parent build node never ran, so there is no parent build
// agent to resume from — lineage would have to be plumbed from the plan agent
// across a child flow boundary. Revisit if repo-warm context per step proves
// worth it.
//
// Approve ≠ MR: approving the step triggers `mergeBack` (the merge arena);
// only the PARENT's final aggregate approval creates the MR through the
// existing approveBuild chain.

/** The payload step as the child reads it (from the persisted trigger payload). */
interface StepPayload {
  id: string;
  title: string;
  detail: string | null;
  files: string[];
  branch?: string;
}

/**
 * §T6: the step child is a SIBLING def, not a subclass — it extends the
 * AgentRunNode tier directly and composes the shared machinery over
 * `BuildRunSupport` instead of inheriting the parent build's run/refine
 * methods (the fan-out child never used the parent's triggerRuns, branch
 * checklist or prompt body anyway).
 */
export class StepBuildNode extends AgentRunNode<BuildInput, BuildOutput> {
  readonly key = NODE_KEYS.STEP_BUILD;
  readonly label = "Step build";
  readonly promptKeys: readonly string[] = [NODE_KEYS.STEP_BUILD, "build_refine"];
  readonly promptSections: readonly string[] = [NODE_KEYS.STEP_BUILD];
  /** Fan-out children ride the parent build's graph slot (no template row of
   *  their own in the built-in graph; edges default to none — the child's
   *  flow runs the seeded step-build template, not the build → pipeline edge). */
  readonly order = 20;

  /** The shared run machinery (§T6) — composed, from this def's own injected
   *  services so a test stub rides the same seam. */
  private readonly buildRun: BuildRunSupport;

  /**
   * The fan-out capabilities: `mergeBack` (the ONLY def with it in Phase 1)
   * and the aggregate output contract. mergeBack runs in the parent's merge
   * arena on step approval — conflict handling lands in Phase 2. Component
   * data "Built-in" (parallel key run naming, nodes need max_commit_fix...
   * cross) — see class doc above for the lineage decision.
   */
  readonly capabilities: NodeCapabilities = {
    panelTitle: "Step changes",
    fanoutOutput: DEFAULT_FANOUT_OUTPUT,
    refinable: true,
    mergeBack: async (args: MergeBackArgs): Promise<MergeBackResult> =>
      mergeArena.mergeStepBranch(args),
  };

  /**
   * The knobs the step child actually consumes: ambient MCP servers for its
   * build/refine runs (default = ALL sources, the plan/build default the
   * child inherited when it subclassed BuildNode). The fan-out knobs
   * (`branch_pattern`, `max_commit_fix_attempts`, fan-out mode/child) belong
   * to the PARENT fan-out node's config — the StepFlowManager reads them
   * from the parent flow's node row, never from the child.
   */
  readonly configSchema = z.object({
    mcp_sources: mcpSourcesSchema.default(DEFAULT_MCP_SOURCES),
  });
  readonly configFields = mcpSourceConfigFields;

  readonly inputSchema = BuildInput;
  readonly outputSchema = BuildOutput;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    super(support, runner, ctxHelper);
    this.buildRun = new BuildRunSupport(support, ctxHelper);
  }

  override triggerRuns(ctx: FlowCtx): NodeTriggerRun[] {
    const step = this.payloadOf(ctx)?.step;
    if (!step) throw new Error("this step child has no step payload — the fan-out linkage is broken");
    return [{ input: { step, prompt: null, feedback: null, model: null } }];
  }

  async run(ctx: FlowCtx, input: BuildInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // developer follow-up: fix the SAME step branch (the build_refine prompt
    // minus the checklist machinery — a step never self-reports progress)
    if (input.feedback) return this.refineStep(ctx, input.feedback, input.model);

    const payload = this.payloadOf(ctx);
    const step = payload?.step;
    if (!step) throw new Error("this step child has no step payload to build");
    const settingSources = mcpSourcesOf(config);

    const node = this.node(ctx);
    const mode = this.ctxHelper.execMode(ctx);
    // the step branch was assigned by the StepFlowManager (flows.mr_branch on
    // the child row); the built-in naming is the fallback
    const branch = this.buildRun.flowBranch(ctx);
    const parentFlowId = ctx.flow.parent_flow_id;
    if (!parentFlowId) throw new Error("the step child has no parent flow — not a fan-out child");

    // local mode builds run in the child's own worktree keyed by the child
    // flow id (one step branch each; the existing sweep covers the children)
    const { worktree, setupNote } = await this.buildRun.worktree(ctx, branch, node.id);

    const ticketType = this.ctxHelper.taskLabel(ctx);
    let instructions = mode === "local"
      ? `Implement ONE step of the approved plan below for a ${ticketType} ticket. Your working directory is a git worktree already checked out on your step branch "${branch}" (fresh off the repo's default branch). Make the code changes, commit them to that branch, and push the branch to origin. Do NOT open a merge request, do not switch branches, and do not touch any checkout outside this directory.`
      : `Implement ONE step of the approved plan below for a ${ticketType} ticket. Make the code changes for exactly that step, commit them, and push to your step branch "${branch}". Do NOT open a merge request.`;
    instructions += this.buildRun.setupAdvisory(setupNote);

    const planMarkdown = await this.parentPlanMarkdown(parentFlowId);
    const stepSection = [
      `- id: ${step.id}`,
      `- title: ${step.title}`,
      step.detail ? `- detail: ${step.detail}` : null,
      step.files.length ? `- files you own: ${step.files.join(", ")}` : "- files: (workflow gave no exact file list — infer from the step's scope in the plan)",
      ``,
      `Implement exactly this step — nothing more. Other steps of the plan are being built by separate sibling agents; your branch merge is the only thing the reviewer sees for this step.`,
    ].filter(Boolean).join("\n");
    const contextPack = this.contextPack(payload);

    const prompt = prompts.resolve(
      NODE_KEYS.STEP_BUILD,
      { ticket: this.ctxHelper.taskContext(ctx), branch, mode },
      { instructions, plan: planMarkdown || "(no plan text found on the parent flow)", step_section: stepSection, context_pack: contextPack },
      input.prompt,
    );

    return this.execute(ctx, {
      input: { ...input, prompt, branch },
      prompt,
      agent: {
        mode: "agent",
        name: `step build ${ctx.task.key} (${step.id})`,
        autoCreatePR: false,
        // local worktree mode: the branch already exists (created with the
        // worktree) — the cloud side lets the agent branch off the default ref
        startingRef: mode === "local" ? branch : (ctx.repo?.default_branch ?? "main"),
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources,
      },
      label: `step build (${step.id})`,
      finalize: (result) => this.finalizeStep(ctx, result, branch, node),
    });
  }

  /** Per-step build terminal: diff artifact + awaiting_approval… with NO build-progress self-reporting (steps go green on merge). */
  private async finalizeStep(
    ctx: FlowCtx,
    result: AgentRunResult,
    branch: string,
    node: NodeRow,
  ): Promise<RunOutcome> {
    const resultBranch = await this.buildRun.resultBranch(ctx, result, branch);
    const art = await this.buildRun.diffArtifact(ctx, node.id, resultBranch, {
      noDiffContent: "(diff unavailable)",
    });
    return {
      status: "awaiting_approval",
      output: this.outputSchema.parse({ branch: resultBranch, latestArtifact: art.id }),
      event: `step build pushed ${resultBranch}; per-step diff ready for review`,
      eventData: { stat: art.stat },
      reply: result.result ?? "",
    };
  }

  /** Chat refinement inside the child: follow-up fix on the same step branch. */
  private async refineStep(ctx: FlowCtx, feedback: string, model?: string | null): Promise<RunOutcome> {
    const node = this.node(ctx);
    const branch = this.buildRun.flowBranch(ctx);
    const { worktree, setupNote } = await this.buildRun.worktree(ctx, branch, node.id);
    let prompt = prompts.resolve("build_refine", {}, { feedback });
    prompt += this.buildRun.setupAdvisory(setupNote);
    const outcome = await this.execute(ctx, {
      input: { feedback, prompt: null, model: model ?? null },
      prompt,
      agent: {
        mode: "agent",
        name: `step build refine ${ctx.task.key}`,
        followUpOn: this.support.lastAgentId(node.id),
        startingRef: branch,
        cwd: worktree ?? undefined,
        model,
        settingSources: mcpSourcesOf(this.nodeConfig(ctx)),
      },
      label: "step build refine",
      finalize: async (result) => {
        const resultBranch = await this.buildRun.resultBranch(ctx, result, branch);
        const art = await this.buildRun.diffArtifact(ctx, node.id, resultBranch, {
          noDiffContent: result.result ?? "",
          extraMeta: { feedback },
        });
        return {
          status: "awaiting_approval" as const,
          output: this.outputSchema.parse({ branch: resultBranch, latestArtifact: art.id }),
          event: `step updated per feedback; new per-step diff ready`,
          reply: result.result ?? "Done.",
        };
      },
    });
    return outcome;
  }

  /**
   * Complete a step child whose agent run was orphaned (server restarted
   * mid-run) but left commits on the step branch — the shape the child
   * inherited from the parent build's recovery before the composition split
   * (§T6), now persisted through the ONE outcome path (§T2).
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    // idempotent: a concurrent reconcile may have already recovered this node
    if (node.status !== "running") return true;
    const branch = this.buildRun.reportedBranch(result) ?? this.buildRun.flowBranch(ctx);
    this.support.setFlowBranch(ctx.flow.id, branch);
    ctx.flow.mr_branch = branch;
    const art = await this.buildRun.diffArtifact(ctx, node.id, branch, {
      noDiffContent: "(diff unavailable — fetch from GitLab)",
      extraMeta: { recovered: true },
    });
    this.applyOutcome(ctx, {
      status: "awaiting_approval",
      output: this.outputSchema.parse({ branch, latestArtifact: art.id }),
      event: `step build recovered on branch ${branch}; diff ready for review`,
      eventData: { stat: art.stat, recovered: true },
      reply: "",
    }, { note });
    return true;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /** The child flow's persisted `{plan, step, siblings, parentNodeKey}` payload. */
  private payloadOf(ctx: FlowCtx): { step: StepPayload; siblings: { id: string; title: string; files: string[]; status: string }[] } | null {
    const raw: unknown = (ctx.flow as FlowRow).trigger_payload ?? null;
    const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const step = p.step && typeof p.step === "object" ? (p.step as Record<string, unknown>) : null;
    if (!step) return null;
    const sp: StepPayload = {
      id: String(step.id ?? ""),
      title: String(step.title ?? ""),
      detail: typeof step.detail === "string" ? step.detail : null,
      files: Array.isArray(step.files) ? (step.files as unknown[]).filter((f): f is string => typeof f === "string") : [],
      ...(typeof step.branch === "string" ? { branch: step.branch } : {}),
    };
    const siblings = Array.isArray(p.siblings)
      ? (p.siblings as Record<string, unknown>[]).map((s) => ({
        id: String(s?.id ?? ""),
        title: String(s?.title ?? ""),
        files: Array.isArray(s?.files) ? (s?.files as unknown[]).filter((f): f is string => typeof f === "string") : [],
        status: String(s?.status ?? "pending"),
      }))
      : [];
    return { step: sp, siblings };
  }

  /** The FULL parent plan markdown, so the child agent knows where its step sits. */
  private async parentPlanMarkdown(parentFlowId: string): Promise<string> {
    const row = this.support.latestArtifact(parentFlowId, "plan");
    return row?.content ?? "";
  }

  /** The sibling context pack (advisory: don't touch other steps' files).
   *  Phase 3A: payload siblings are refreshed at start time — the pack shows
   *  live states (building / awaiting approval / merged / failed / skipped),
   *  a non-code sibling's output summary and a code sibling's merge state,
   *  so parallel siblings read the current picture rather than the
   *  expand-time snapshot. */
  private contextPack(payload: unknown): string {
    const siblings = (payload as { siblings?: unknown })?.siblings;
    if (!Array.isArray(siblings) || !siblings.length) return "(no sibling steps)";
    const lines = siblings.map((raw) => {
      const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const files = Array.isArray(s.files) ? (s.files as unknown[]).filter((f): f is string => typeof f === "string") : [];
      const merge = typeof s.mergeStatus === "string" && s.mergeStatus ? ` · merge: ${s.mergeStatus}` : "";
      const summary = typeof s.summary === "string" && s.summary ? ` — summary: ${s.summary}` : "";
      return `- ${String(s.id ?? "")}: ${String(s.title ?? "")}${files.length ? ` (files: ${files.join(", ")})` : ""} — currently ${String(s.status ?? "pending")}${merge}${summary}`;
    });
    return [
      ...lines,
      ``,
      `Do NOT modify files owned by other pending steps; if your step genuinely requires one, keep the change minimal and call it out in your summary.`,
    ].join("\n");
  }
}
