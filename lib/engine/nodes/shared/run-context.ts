import fs from "fs";
import path from "path";
import type { Repo } from "../../../db";
import type { FlowRow, Task } from "../../../db/rows";
import { localGit } from "../../../git/local";
import { authedCloneUrlFor } from "../../ports/git-host";
import { taskRegistry } from "../../tasks/registry";

// ── context ──────────────────────────────────────────────────────────────────
export type ExecMode = "cloud" | "local";

export interface FlowCtx {
  flow: FlowRow;
  task: Task;
  repo?: Repo | null; // registered repo (when flow.repo_id set / matched)
}

/**
 * Derived facts about a flow context: execution mode, local path, branch
 * naming, task prompt block, and diff construction. Stateless — safe to
 * share as a singleton.
 */
export class FlowContextHelper {
  execMode(ctx: FlowCtx): ExecMode {
    return ctx.flow.execution_mode === "local" ? "local" : "cloud";
  }

  localPath(ctx: FlowCtx): string | null {
    return ctx.repo?.local_path ?? null;
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
    const wt = ctx.flow.worktree_dir;
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
    return [
      `# ${this.taskLabel(ctx)} ${t.key}: ${t.summary}`,
      `Status: ${t.status} · Type: ${t.issueType} · Priority: ${t.priority}`,
      `\n## PRD / Description\n${t.prdText || t.description || "(none)"}`,
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
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    const base = `${prefix}/${slug}-${ctx.flow.id.slice(-6)}`;
    return suffix ? `${base}-${suffix}` : base;
  }

  async makeDiff(ctx: FlowCtx, branch: string) {
    // Prefer local refs when the branch only exists locally — diffBranch fetches
    // from origin, which can hang for a minute+ when the remote is unreachable.
    const lp = this.localPath(ctx);
    if (lp) {
      const s = await localGit.localBranchState(lp, branch, ctx.repo?.default_branch ?? "main").catch(() => null);
      if (s && s.exists && s.raw) return { files: [], stat: s.stat, raw: s.raw };
    }
    return localGit.diffBranch(ctx.flow.id, ctx.flow.repo_url ?? "", branch, undefined, lp, authedCloneUrlFor).catch(() => null);
  }
}

export const flowCtxHelper = new FlowContextHelper();
