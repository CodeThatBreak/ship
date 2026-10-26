import { db } from "../../../db";
import type { FlowCtx, NodeTriggerRun, RunOutcome } from "../base";
import type { FlowRow, NodeRow } from "../../../db/rows";
import { prompts } from "../../prompts";
import { DEFAULT_FANOUT_OUTPUT } from "../base/capabilities";
import type { MergeBackArgs, MergeBackResult, NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import { localGit } from "../../../git/local";
import { mcpSourcesOf } from "../../node-config";
import { worktreeManager } from "../../worktree-lifecycle";
import { mergeArena } from "../../merge-arena";
import { BuildNode } from "./build-node";
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

export class StepBuildNode extends BuildNode {
  readonly key = NODE_KEYS.STEP_BUILD;
  readonly label = "Step build";
  override readonly promptKeys: readonly string[] = [NODE_KEYS.STEP_BUILD, "build_refine"];
  override readonly promptSections: readonly string[] = [NODE_KEYS.STEP_BUILD];

  /**
   * The fan-out capabilities: `mergeBack` (the ONLY def with it in Phase 1)
   * and the aggregate output contract. mergeBack runs in the parent's merge
   * arena on step approval — conflict handling lands in Phase 2. Component
   * data "Built-in" (parallel key run naming, nodes need max_commit_fix...
   * cross) — see class doc above for the lineage decision.
   */
  override readonly capabilities: NodeCapabilities = {
    panelTitle: "Step changes",
    fanoutOutput: DEFAULT_FANOUT_OUTPUT,
    mergeBack: async (args: MergeBackArgs): Promise<MergeBackResult> =>
      mergeArena.mergeStepBranch(args),
  };

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
    const branch = ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    const parentFlowId = ctx.flow.parent_flow_id;
    if (!parentFlowId) throw new Error("the step child has no parent flow — not a fan-out child");

    // local mode builds run in the child's own worktree keyed by the child
    // flow id (one step branch each; the existing sweep covers the children)
    let worktree: string | null = null;
    let setupNote: string | null = null;
    if (mode === "local") {
      const binding = await worktreeManager.ensureFlowWorktree(ctx, branch, { nodeId: node.id });
      worktree = binding.dir;
      setupNote = binding.setupNote;
    }

    const ticketType = this.ctxHelper.taskLabel(ctx);
    let instructions = mode === "local"
      ? (worktree
        ? `Implement ONE step of the approved plan below for a ${ticketType} ticket. Your working directory is a git worktree already checked out on your step branch "${branch}" (fresh off the repo's default branch). Make the code changes, commit them to that branch, and push the branch to origin. Do NOT open a merge request, do not switch branches, and do not touch any checkout outside this directory.`
        : `Implement ONE step of the approved plan below for a ${ticketType} ticket. First create and check out a new git branch named "${branch}" (from the repo's default branch), then make the code changes, commit them, and push the branch to origin. Do NOT open a merge request.`)
      : `Implement ONE step of the approved plan below for a ${ticketType} ticket. Make the code changes for exactly that step, commit them, and push to your step branch "${branch}". Do NOT open a merge request.`;
    if (setupNote) instructions += `\n${setupNote} If the changes need dependencies, run the repo's dependency setup yourself before building/testing.`;

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
      promptOverride: input.prompt,
      agent: {
        mode: "agent",
        name: `step build ${ctx.task.key} (${step.id})`,
        autoCreatePR: false,
        // local worktree mode: the branch already exists (created with the
        // worktree) — the cloud side lets the agent branch off the default ref
        startingRef: worktree ? branch : (ctx.repo?.default_branch ?? "main"),
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
    result: import("../../ports/agent-runner").AgentRunResult,
    branch: string,
    node: NodeRow,
  ): Promise<RunOutcome> {
    const resultBranch =
      this.ctxHelper.execMode(ctx) === "local"
        ? (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx))) ?? branch
        : result.git?.branches?.[0]?.branch ?? branch;
    if (!resultBranch) throw new Error("step build finished but no branch was pushed");

    const diff = await this.makeDiff(ctx, resultBranch);
    const art = this.support.saveArtifact(
      node.id, ctx.flow.id, "diff",
      diff ? diff.raw : "(diff unavailable)",
      { branch: resultBranch, stat: diff?.stat ?? "" }
    );
    return {
      status: "awaiting_approval",
      output: this.outputSchema.parse({ branch: resultBranch, latestArtifact: art.id }),
      event: `step build pushed ${resultBranch}; per-step diff ready for review`,
      eventData: { stat: diff?.stat },
      reply: result.result ?? "",
    };
  }

  /** Chat refinement inside the child: follow-up fix on the same step branch. */
  private async refineStep(ctx: FlowCtx, feedback: string, model?: string | null): Promise<RunOutcome> {
    const node = this.node(ctx);
    const branch = ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    let worktree: string | null = null;
    let setupNote: string | null = null;
    if (this.ctxHelper.execMode(ctx) === "local") {
      const binding = await worktreeManager.ensureFlowWorktree(ctx, branch, { nodeId: node.id });
      worktree = binding.dir;
      setupNote = binding.setupNote;
    }
    let prompt = prompts.resolve("build_refine", {}, { feedback });
    if (setupNote) prompt += `\n${setupNote}`;
    const outcome = await this.execute(ctx, {
      input: { feedback, prompt: null, model: model ?? null },
      prompt,
      promptOverride: null,
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
        const resultBranch =
          this.ctxHelper.execMode(ctx) === "local"
            ? (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx))) ?? branch
            : result.git?.branches?.[0]?.branch ?? branch;
        const diff = await this.makeDiff(ctx, resultBranch);
        const art = this.support.saveArtifact(
          node.id, ctx.flow.id, "diff",
          diff ? diff.raw : (result.result ?? ""),
          { branch: resultBranch, stat: diff?.stat ?? "", feedback }
        );
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
    const row = db.get<{ content: string }>(
      `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`,
      parentFlowId
    );
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
