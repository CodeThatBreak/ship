import "server-only";

import fs from "fs";
import path from "path";
import { db, type Repo } from "../../../db/app";
import { samePath, worktrees } from "../../../git/worktrees";
import { workspacePaths } from "../../../git/workspacePaths";
import type { FlowCtx } from "../../nodes/shared/runContext/types/flowContext";
import type { WorktreeBinding } from "./types/worktreeBinding";
import { realpathOrResolve } from "./utils/realpathOrResolve";
import { WorktreeActivity } from "./worktreeActivity";
import { WorktreeDepSetup } from "./worktreeDepSetup";
import { WorktreeRemover } from "./worktreeRemover";
import { WorktreeSweeper } from "./worktreeSweeper";

/**
 * WorktreeManager — the flow ↔ worktree binding facade (engine §1 runtime
 * services). Joins the pure worktree layer (lib/git/worktrees.ts) to
 * db/config state: ensures the flow's worktree exists with the right branch
 * (`ensureFlowWorktree`), resolves the run cwd for agent runs with a
 * coalescing one-ensure-per-flow mutex (`ensureForRun`), and delegates
 * removal and the startup sweep to WorktreeRemover / WorktreeSweeper. All
 * git mechanics live in the pure class — this facade only binds state.
 *
 * Layout: each local-mode flow's worktree lives at
 * `workspaces/worktrees/<flowId>` — outside the repo tree (the developer's
 * checkout stays the hub: it owns the object database, refs and config, and
 * is never mutated unless the repo opts out with `use_worktrees = 0`, in
 * which case flows run in the checkout itself).
 *
 * Invariants:
 * - the `ensureInFlight` map is process-pinned state (decision Q9 — this
 *   instance is pinned via `../worktreeLifecycle.ts`): one in-flight
 *   ensure per flow, concurrent callers share the work. Per-module-graph
 *   copies would race the same worktree path. Durable truth (bindings,
 *   removal records) lives in Postgres.
 * - non-null `dir` results are persisted on `flows.worktreeDir` in canonical
 *   (realpath) form before returning.
 *
 * Must-never: never fall back to the registered checkout on creation failure
 * (agent runs mutating the developer's real checkout cross-contaminate
 * concurrent flows — the node fails loudly instead); never switch an existing
 * worktree's branch implicitly during `ensureForRun` (the tree's CURRENT
 * branch wins when one exists).
 */
export class WorktreeManager {
  /** One in-flight ensure per flow — concurrent callers share the work. */
  private ensureInFlight = new Map<string, Promise<WorktreeBinding>>();

  constructor(
    private readonly activity: WorktreeActivity = new WorktreeActivity(),
    private readonly depSetup: WorktreeDepSetup = new WorktreeDepSetup(activity),
    private readonly remover: WorktreeRemover = new WorktreeRemover(),
    private readonly sweeper: WorktreeSweeper = new WorktreeSweeper(remover),
  ) {}

  /** A flow's worktree dir: `workspaces/worktrees/<flowId>` (unique per flow; sweep-joinable). */
  private worktreeDirForFlow(flowId: string): string {
    return workspacePaths.worktreeDir(flowId);
  }

  // ── create / ensure ────────────────────────────────────────────────────────

  /**
   * Ensure the flow's worktree exists with `branch` checked out and return its
   * binding — `{ dir: null }` when worktrees don't apply (cloud mode). When the
   * repo disables worktrees (`repos.useWorktrees = 0`), local-mode runs bind
   * the registered checkout directly — the user opted out of parallel isolation.
   * Creation failure THROWS (fatal to the node): agent runs mutating the
   * developer's registered checkout cross-contaminated concurrent flows, so
   * the old hub fallback was removed — the node fails loudly with the reason
   * and can be retried once fixed. A fresh worktree runs the repo's
   * dependency-setup policy once (per flow, not per run); a setup failure
   * remains non-fatal, surfaced as `setupNote` for the agent's run prompt.
   * Non-null `dir` results are persisted on `flows.worktreeDir` before
   * returning.
   */
  async ensureFlowWorktree(
    ctx: FlowCtx,
    branch: string,
    opts: { nodeId?: string | null } = {}
  ): Promise<WorktreeBinding> {
    const flow = ctx.flow;
    if (flow.executionMode !== "local") return { dir: null, setupNote: null };
    const hub = ctx.repo?.localPath ?? null;
    if (!hub) {
      throw new Error(
        "This flow runs in local mode but its repo has no local path configured. Set one on the Settings page."
      );
    }

    if (!this.worktreesEnabled(ctx.repo)) {
      // repo opted out: run in the registered checkout itself. A worktree left
      // over from before the toggle flip is removed (branch kept) so the
      // binding, sweep and status badge all agree on "no worktree".
      if (flow.worktreeDir) {
        await this.removeFlowWorktree(flow.id, {
          reason: "worktrees disabled for this repo",
        });
        flow.worktreeDir = null;
      }
      const dir = realpathOrResolve(hub);
      await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
        `running in the registered checkout (${dir}) — worktrees disabled`,
        await this.activity.lifecycleData(flow.id, opts.nodeId, { branch }));
      await this.activity.touchNode(flow.id, opts.nodeId);
      return { dir, setupNote: null };
    }

    const dir = this.worktreeDirForFlow(flow.id);
    // visibility: the ensure can run for minutes on a first checkout — surface
    // it in the node's activity feed immediately instead of leaving the node
    // silent until the create/reuse outcome lands
    await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
      `setting up worktree (branch ${branch})…`,
      await this.activity.lifecycleData(flow.id, opts.nodeId, { branch }));
    await this.activity.touchNode(flow.id, opts.nodeId);
    try {
      const result = await worktrees.createWorktree({
        repoPath: hub,
        dir,
        branch,
        base: ctx.repo?.defaultBranch ?? "main",
        addTimeoutMs: ctx.repo?.worktreeTimeoutMs ?? undefined,
      });
      // store the canonical (realpath) spelling — git canonicalizes worktree
      // paths itself (e.g. /var → /private/var on macOS), and sweep/removal
      // matching joins against `git worktree list` output
      const canonical = realpathOrResolve(dir);
      if (!flow.worktreeDir || !samePath(flow.worktreeDir, canonical)) {
        await db.prisma.flow.update({ where: { id: flow.id }, data: { worktreeDir: canonical, updatedAt: new Date() } });
        flow.worktreeDir = canonical;
      }
      await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
        result.reused
          ? `worktree reused at ${canonical} (branch ${result.headBranch})`
          : `worktree created at ${canonical} (branch ${branch} off ${result.base})`,
        await this.activity.lifecycleData(flow.id, opts.nodeId, {
          worktree: canonical,
          branch,
          base: result.base ?? undefined,
        }));
      await this.activity.touchNode(flow.id, opts.nodeId);
      // deps setup runs once per flow (the worktree persists build → fixes →
      // re-gates → resolve, including session resumes); reuse skips it
      const setupNote = result.reused
        ? null
        : await this.depSetup.setupFlowWorktree(ctx, { dir: canonical, hub, nodeId: opts.nodeId ?? null });
      return { dir: canonical, setupNote };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.emitEvent(flow.id, opts.nodeId ?? null, "error",
        `worktree setup failed (${msg})`,
        await this.activity.lifecycleData(flow.id, opts.nodeId));
      // fatal: agent runs must never fall back to the registered checkout —
      // they would mutate the developer's real checkout and cross-contaminate
      // concurrent flows. The node fails loudly; retry once fixed.
      throw new Error(
        `worktree setup failed: ${msg} — fix the worktree configuration and retry the node`
      );
    }
  }

  // ── runner ensure (Option B) ────────────────────────────────────────────────

  /**
   * Runner-facing ensure (Option B): resolve the run cwd for an agent run.
   * Rules: an explicit pin always wins (returned untouched, no manager
   * involvement); read-only runs (mode=plan) get no worktree; an unpinned
   * mutating run is ensured into the flow's worktree with the tree's CURRENT
   * branch when one exists (never an implicit switch), else the flow's
   * canonical mr_branch, else the caller's default branch (the build naming
   * convention). setupNote is the once-per-flow deps-setup failure line — the
   * caller appends it to the run prompt so the agent can self-repair.
   * Creation failure throws (the run fails — no fallback to the hub).
   */
  async ensureForRun(
    ctx: FlowCtx,
    opts: {
      mode?: "agent" | "plan";
      cwd?: string; // the node's pin, when it passed one
      nodeId?: string | null;
      defaultBranch: string; // buildBranch(ctx) from the runner
    }
  ): Promise<{ cwd: string | undefined; setupNote: string | null }> {
    if (opts.cwd) return { cwd: opts.cwd, setupNote: null };
    if (opts.mode !== "agent") return { cwd: undefined, setupNote: null };
    const desiredBranch =
      (await this.currentWorktreeBranch(ctx)) ?? ctx.flow.mrBranch ?? opts.defaultBranch;

    while (true) {
      const inflight = this.ensureInFlight.get(ctx.flow.id);
      if (inflight) {
        await inflight.catch(() => undefined);
        await this.activity.touchNode(ctx.flow.id, opts.nodeId ?? null);
        const head = await this.currentWorktreeBranch(ctx);
        if (head === desiredBranch && ctx.flow.worktreeDir) {
          const dir = realpathOrResolve(ctx.flow.worktreeDir);
          if (fs.existsSync(path.join(dir, ".git"))) {
            return { cwd: dir, setupNote: null };
          }
        }
        if (this.ensureInFlight.has(ctx.flow.id)) continue;
      }

      const p = this.ensureFlowWorktree(ctx, desiredBranch, { nodeId: opts.nodeId ?? null })
        .finally(() => {
          if (this.ensureInFlight.get(ctx.flow.id) === p) {
            this.ensureInFlight.delete(ctx.flow.id);
          }
        });
      this.ensureInFlight.set(ctx.flow.id, p);
      const binding = await p;
      return { cwd: binding.dir ?? undefined, setupNote: binding.setupNote };
    }
  }

  /**
   * The head branch of the flow's existing worktree, or null when the flow
   * has none on disk. Listing failure → null (the ensure itself re-lists
   * strictly and fails non-fatally).
   */
  private async currentWorktreeBranch(ctx: FlowCtx): Promise<string | null> {
    const dir = ctx.flow.worktreeDir;
    if (!dir) return null;
    try {
      if (!fs.existsSync(path.join(dir, ".git"))) return null;
      return await worktrees.headBranch(dir);
    } catch {
      return null;
    }
  }

  // ── removal / sweep delegation ─────────────────────────────────────────────

  /** The repo's worktree opt-out (`repos.useWorktrees = 0`); on when unset. */
  private worktreesEnabled(repo: Repo | null | undefined): boolean {
    if (!repo) return true;
    return Boolean(repo.useWorktrees);
  }

  /**
   * Remove a flow's worktree (flow terminal state / flow deletion). No-op when
   * the flow has none. Public so future terminal-state hooks can call it.
   */
  async removeFlowWorktree(
    flowId: string,
    opts: { deleteBranch?: boolean; reason?: string } = {}
  ): Promise<void> {
    await this.remover.removeFlowWorktree(flowId, opts);
  }

  /**
   * One-time sweep at server start (runs from the poller's lazy start) —
   * see WorktreeSweeper for the full contract.
   */
  async sweepWorktrees(): Promise<void> {
    await this.sweeper.sweepWorktrees();
  }
}
