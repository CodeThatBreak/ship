import "server-only";

import fs from "fs";
import path from "path";
import { localGit } from "../../../../git/local";
import { worktrees } from "../../../../git/worktrees";
import { gitRemoteContextFor } from "../../../ports/gitHost";
import { taskRegistry } from "../../../tasks/registry";
import { untrustedData } from "../../../prompts/untrustedData";
import { resolveRunMode } from "../../../utils/runMode";
import { TASK_PRD_CAP } from "../../../prompts/caps";
import { branchNamer } from "../branchNamer";
import type { ExecMode, FlowCtx } from "./types/flowContext";
import { DIFF_ATTRIBUTION } from "../../../facts/constants/diffFactMeta";
import type { DiffCapture, DiffProjection } from "../../../facts/types/facts";

/**
 * Derived facts about a flow context: execution mode, local path, branch
 * naming, task prompt block, and diff construction. Stateless — safe to
 * share as a singleton (pinned in `nodes/shared/runContext.ts`; class files
 * are pure — classFilePurity arch test).
 */
export class FlowContextHelper {
  execMode(ctx: FlowCtx): ExecMode {
    return resolveRunMode(ctx.flow.executionMode);
  }

  localPath(ctx: FlowCtx): string | null {
    return ctx.repo?.localPath ?? null;
  }

  requireLocalPath(ctx: FlowCtx): string {
    const p = this.localPath(ctx);
    if (!p) {
      throw new Error(
        "This flow runs in local mode but its repo has no local path configured. Set one on the Settings page."
      );
    }
    return p;
  }

  /**
   * The cwd local agent runs should use: the flow's git worktree when one is
   * persisted and still on disk, else the registered checkout (the hub).
   * Worktree mechanics stay in lib/git/worktrees.ts; this only reads the
   * flow row's pointer.
   */
  runCwd(ctx: FlowCtx): string | null {
    const wt = ctx.flow.worktreeDir;
    if (wt) {
      try {
        if (fs.existsSync(path.join(wt, ".git"))) return wt;
      } catch { /* fall through to the hub */ }
    }
    return this.localPath(ctx);
  }

  /** Like requireLocalPath, but prefers the flow's worktree. */
  requireRunCwd(ctx: FlowCtx): string {
    const p = this.runCwd(ctx);
    if (!p) {
      throw new Error(
        "This flow runs in local mode but its repo has no local path configured. Set one on the Settings page."
      );
    }
    return p;
  }

  taskContext(ctx: FlowCtx): string {
    const t = ctx.task;
    const figma = (t.figmaUrls ?? []).map((u: string) => `- ${u}`).join("\n");
    // the PRD/description is untrusted provider content — fenced with the loud
    // cap (the plan/build/step-build prompts all embed this block)
    const prdSource = t.prdText || t.description || "";
    const prd = prdSource
      ? untrustedData({ source: "task PRD", text: prdSource, cap: TASK_PRD_CAP }).text
      : "(none)";
    return [
      `# ${this.taskLabel(ctx)} ${t.key}: ${t.summary}`,
      `Status: ${t.status} · Type: ${t.issueType} · Priority: ${t.priority}`,
      `\n## PRD / Description\n${prd}`,
      figma ? `\n## Figma designs\n${figma}` : "",
    ].join("\n");
  }

  /** The task provider's UI label for the flow's task type ("task" when unregistered). */
  taskLabel(ctx: FlowCtx): string {
    return taskRegistry.maybe(ctx.task.type)?.label ?? "task";
  }

  /**
   * Branch naming shared by cloud + local builds.
   * Uses bugfix/<task>-<flowid6> (feature/ when the task is a story) — many
   * repos enforce branch-name patterns via pre-receive hooks, and a `cursor/...`
   * name gets rejected on push. Optional suffix for multi-branch builds.
   */
  buildBranch(ctx: FlowCtx, suffix?: string): string {
    return branchNamer.builtInBranch(ctx, suffix);
  }

  /**
   * The run-start base SHA (Task 08): the resolved base_ref pinned to the
   * commit it pointed at when the run began — the `agent` attribution
   * projection's anchor. Read-only local git (one rev-parse); null when
   * there is no local checkout or the ref does not resolve, in which case
   * the capture stays unattributed (the `all` projection only).
   */
  async baseShaOf(ctx: FlowCtx, ref: string | null | undefined): Promise<string | null> {
    if (!ref) return null;
    const lp = this.localPath(ctx);
    if (!lp) return null;
    return localGit.resolveSha(lp, ref);
  }

  /**
   * The live head SHA of a ref — the write-path counterpart of the diff
   * staleness probe (`facts/diffStalenessProbe.ts`): worktree first, then the
   * hub checkout, at most two bounded local rev-parses. Null when neither
   * resolves — in cloud mode there is no local checkout, so callers fall
   * through to a full capture rather than confusing "unprobeable" with
   * "unchanged". Read-only: never fetches and never persists.
   */
  async headShaOf(ctx: FlowCtx, ref: string): Promise<string | null> {
    const dirs = [this.runCwd(ctx), this.localPath(ctx)].filter((d): d is string => Boolean(d));
    for (const dir of dirs) {
      const sha = await localGit.resolveSha(dir, ref).catch(() => null);
      if (sha) return sha;
    }
    return null;
  }

  /**
   * The diff capture behind a `diff` fact (Task 08 attribution). With a
   * pinned `baseSha` (the run-start base SHA) the capture carries BOTH
   * projections: the `agent` projection (`git diff baseSha..head` — the
   * run's own work, later user commits excluded because the persisted bytes
   * pin the capture) as the content, and the whole-branch projection as
   * `alt`. Without a pin (the fan-out rollup / build-final captures) the
   * capture is the plain whole-branch diff — the pre-Task-08 shape, byte for
   * byte. When the branch carries no committed work but the run's worktree
   * is dirty, the `uncommitted` variant diffs the worktree against
   * `baseSha` instead (headSha still anchors the branch it sits on).
   *
   * Git I/O only — the caller owns persistence (the stepRollup precedent:
   * captures run before the batch, never inside a transaction).
   */
  async makeDiff(ctx: FlowCtx, branch: string, opts: { baseSha?: string | null } = {}): Promise<DiffCapture | null> {
    // Prefer local refs when the branch only exists locally — diffBranch fetches
    // from origin, which can hang for a minute+ when the remote is unreachable.
    const lp = this.localPath(ctx);
    if (lp) {
      const s = await localGit.localBranchState(lp, branch, ctx.repo?.defaultBranch ?? "main").catch(() => null);
      if (s && s.exists) {
        const attributed = opts.baseSha
          ? await this.attributedCapture(lp, ctx, s.headSha, s.stat, s.raw, opts.baseSha)
          : null;
        if (attributed) return attributed;
        // no pinned base (or the agent projection did not resolve) — the
        // plain whole-branch capture, with the head anchor recorded so a
        // later refresh can detect branch movement
        if (s.raw) {
          return { files: [], stat: s.stat, raw: s.raw, baseSha: null, headSha: s.headSha || null, attribution: DIFF_ATTRIBUTION.ALL };
        }
      }
    }
    const d = await localGit.diffBranch(ctx.flow.id, ctx.flow.repoUrl ?? "", branch, undefined, lp, gitRemoteContextFor).catch(() => null);
    if (!d) return null;
    return { files: d.files, stat: d.stat, raw: d.raw, baseSha: null, headSha: d.headSha || null, attribution: DIFF_ATTRIBUTION.ALL };
  }

  /**
   * The attributed capture over a locally-resolvable branch: the `agent`
   * projection (`baseSha..head`) as the content, the whole-branch projection
   * as `alt`. When BOTH committed projections are empty and the run's
   * worktree is dirty, the `uncommitted` variant wins — the worktree diff
   * against `baseSha` is the only work there is. Null when the agent
   * projection cannot be computed (the caller falls back to the plain
   * whole-branch capture).
   */
  private async attributedCapture(
    lp: string,
    ctx: FlowCtx,
    headSha: string,
    wholeStat: string,
    wholeRaw: string,
    baseSha: string,
  ): Promise<DiffCapture | null> {
    const whole: DiffProjection = { attribution: DIFF_ATTRIBUTION.ALL, stat: wholeStat, raw: wholeRaw };
    if (!headSha) return null;
    const agent = await localGit.diffShaRange(lp, baseSha, headSha).catch(() => null);
    if (!agent) return null;
    const uncommitted = !agent.raw.trim() && !whole.raw.trim()
      ? await this.uncommittedCapture(ctx, baseSha, headSha)
      : null;
    if (uncommitted) return uncommitted;
    return { files: [], stat: agent.stat, raw: agent.raw, baseSha, headSha, attribution: DIFF_ATTRIBUTION.AGENT, alt: whole };
  }

  /**
   * The `uncommitted` variant (Task 08): the worktree diff against the
   * pinned base SHA — the changes the agent left uncommitted ("not yet on a
   * branch"). Null when the worktree is clean (there is nothing uncommitted
   * to surface). headSha anchors the commit the uncommitted work sits on.
   */
  private async uncommittedCapture(ctx: FlowCtx, baseSha: string, headSha: string): Promise<DiffCapture | null> {
    const dir = this.runCwd(ctx);
    if (!dir) return null;
    if (!(await worktrees.isWorktreeDirty(dir))) return null;
    const wt = await localGit.worktreeDiff(dir, baseSha).catch(() => null);
    if (!wt) return null;
    return { files: [], stat: wt.stat, raw: wt.raw, baseSha, headSha, attribution: DIFF_ATTRIBUTION.AGENT, uncommitted: true };
  }
}
