import { localGit } from "../../../git/local";
import type { FlowCtx } from "../base";
import { flowCtxHelper, type FlowContextHelper } from "../base/flow-context";
import { nodeSupport, type NodeSupport } from "../base/node-support";
import type { AgentRunResult } from "../../ports/agent-runner";
import { configString } from "../../templates/node-config";
import { worktreeManager } from "../../runtime/worktree-lifecycle";

/**
 * The run machinery the build defs share (§T6): branch assignment, the local
 * worktree lifecycle, result-branch detection and the per-branch review diff
 * artifact. Composition, not inheritance — `BuildNode` (the whole-plan /
 * multi-branch build) and `StepBuildNode` (one fan-out step) each own their
 * `run()` end-to-end over this helper, and the step child no longer inherits
 * the parent's machinery. Both construct it from their own injected services
 * (§T1), so a test stub rides the same seam into every method.
 */
export class BuildRunSupport {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {}

  // ── branch assignment ──────────────────────────────────────────────────────

  /**
   * Branch name from the `branch_pattern` knob (empty = built-in bugfix/feature
   * naming). Tokens: {prefix} {slug} {ticket} {id} {suffix} — many repos enforce
   * branch-name patterns via pre-receive hooks.
   */
  branchName(ctx: FlowCtx, config: Record<string, unknown>, suffix?: string): string {
    const pattern = configString(config, "branch_pattern");
    if (!pattern?.trim()) return this.ctxHelper.buildBranch(ctx, suffix);
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    return pattern
      .trim()
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{slug\}/g, slug)
      .replace(/\{ticket\}/g, String(ctx.task.key ?? "task"))
      .replace(/\{id\}/g, ctx.flow.id.slice(-6))
      .replace(/\{suffix\}/g, suffix ?? "");
  }

  /**
   * The branch a run was assigned before it started: the flow row's branch
   * (the StepFlowManager pre-assigns each step child's branch on
   * `flows.mr_branch`), else the built-in naming.
   */
  flowBranch(ctx: FlowCtx, suffix?: string): string {
    return ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx, suffix);
  }

  // ── worktree lifecycle (local mode; `ensureFlowWorktree` is a no-op in cloud) ──

  /**
   * Ensure this run's branch has a local worktree and return the binding:
   * the checkout directory (null in cloud mode) and the non-fatal per-flow
   * dependency-setup note for the agent's run/refine instructions.
   */
  async worktree(
    ctx: FlowCtx,
    branch: string,
    nodeId: string,
  ): Promise<{ worktree: string | null; setupNote: string | null }> {
    const binding = await worktreeManager.ensureFlowWorktree(ctx, branch, { nodeId });
    return { worktree: binding.dir, setupNote: binding.setupNote };
  }

  /**
   * The deps-setup advisory appended to run/refine instructions (empty when
   * setup succeeded): the agent self-repairs by running the repo's dependency
   * setup itself before building/testing.
   */
  setupAdvisory(setupNote: string | null | undefined): string {
    return setupNote
      ? `\n${setupNote} If the changes need dependencies, run the repo's dependency setup yourself before building/testing.`
      : "";
  }

  // ── run-finish facts ────────────────────────────────────────────────────────

  /** The run cwd's actual git HEAD (local mode only — the developer's hub
   *  checkout must never be read as the build branch). */
  async currentBranch(ctx: FlowCtx): Promise<string | null> {
    if (this.ctxHelper.execMode(ctx) !== "local") return null;
    return (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx))) ?? null;
  }

  /** The branch the agent run reported pushing (cloud runs). */
  reportedBranch(result: AgentRunResult): string | null {
    return result.git?.branches?.[0]?.branch ?? null;
  }

  /**
   * The branch a finished build actually pushed: local mode reads the
   * worktree's HEAD; cloud reads the agent's reported branch. `fallback` is
   * the branch the run was assigned at start.
   */
  async resultBranch(ctx: FlowCtx, result: AgentRunResult, fallback: string): Promise<string> {
    const branch = this.ctxHelper.execMode(ctx) === "local"
      ? (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx)))
      : this.reportedBranch(result);
    return branch ?? fallback;
  }

  /**
   * The branch a chat-refine follow-up pushed: the flow's branch wins (a
   * follow-up always runs on it); local mode reads the worktree's HEAD, cloud
   * the agent's report. Null when neither exists — refiners save the agent's
   * reply as the diff content instead.
   */
  async refineBranch(ctx: FlowCtx, result: AgentRunResult): Promise<string | null> {
    return ctx.flow.mr_branch ?? (
      this.ctxHelper.execMode(ctx) === "local"
        ? await this.currentBranch(ctx)
        : this.reportedBranch(result)
    );
  }

  /**
   * The per-branch review diff artifact — the "finish" artifact every build
   * terminal shares (fresh build, step build, refine follow-up): the raw diff
   * as content, branch + stat (+ caller extras) as meta. `noDiffContent`
   * overrides the no-diff placeholder (refiners echo the agent's reply).
   */
  async diffArtifact(
    ctx: FlowCtx,
    nodeId: string,
    branch: string,
    opts: { noDiffContent?: string; extraMeta?: Record<string, unknown> } = {},
  ): Promise<{ id: string; stat: string | undefined }> {
    const diff = await this.ctxHelper.makeDiff(ctx, branch);
    const art = this.support.saveArtifact(
      nodeId, ctx.flow.id, "diff",
      diff ? diff.raw : (opts.noDiffContent ?? "(diff unavailable)"),
      { branch, stat: diff?.stat ?? "", ...opts.extraMeta },
    );
    return { id: art.id, stat: diff?.stat };
  }
}
