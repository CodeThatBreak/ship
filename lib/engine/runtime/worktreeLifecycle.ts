import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { workspacePaths } from "../../git/workspacePaths";
import { db, type Repo } from "../../db/app";
import { rows, WorktreeRemovalRow } from "../../db/rows";
import { processSingleton } from "../../singleton";
import {
  containsPath,
  isDangerousWorktreeRemovalPath,
  samePath,
  worktrees,
  worktreeBranchName,
} from "../../git/worktrees";
import { depPolicies, type RepoDepOverrides } from "../../git/depPolicy";
import { worktreeSetup } from "../../git/worktreeSetup";
import type { FlowCtx } from "../nodes/shared/runContext";

interface RemovalTarget {
  flowId: string | null;
  /** hub path, when known (null → the worktree is dead weight, plain fs delete) */
  repoPath: string | null;
  wtPath: string;
  branch: string | null;
  /** branch cleanup is merged-only by default (unmerged commits are the work product) */
  deleteBranch?: boolean;
  reason?: string;
  /** reuse an existing removal record instead of inserting a new one */
  recordId?: string;
}

/**
 * The flow's worktree binding, returned by ensureFlowWorktree: the run cwd
 * plus a one-line setup note when deps setup failed (non-fatal — the caller
 * appends it to the agent's run prompt so the agent can self-repair).
 * `dir` is null when worktrees don't apply (cloud mode): local mode either
 * binds a worktree (default) or, when the repo disables worktrees, binds the
 * registered checkout directly — agent runs never fall back silently.
 */
export interface WorktreeBinding {
  dir: string | null;
  setupNote: string | null;
}

/**
 * Engine-side manager for the pure worktree layer (lib/git/worktrees.ts).
 * Owns the flow ↔ worktree binding (`flows.worktreeDir`), the dependency-setup
 * run (policy resolved from lib/git/dep-policy.ts, executed by
 * lib/git/worktree-setup.ts), crash-safe removal records (persisted BEFORE git
 * runs, resumed by the startup sweep), and the sweep itself. All git mechanics
 * live in the pure class — this class only joins them to db/config state.
 *
 * Layout: each local-mode flow's worktree lives at `workspaces/worktrees/<flowId>` —
 * outside the repo tree (the developer's checkout stays the hub: it owns the
 * object database, refs and config, and is never mutated unless the repo opts
 * out with `use_worktrees = 0`, in which case flows run in the checkout itself).
 */
export class WorktreeManager {
  /** Resolve feed routing key from a node row id (never use the row id as nodeKey). */
  private nodeKeyFor(flowId: string, nodeId: string | null | undefined): string | undefined {
    if (!nodeId) return undefined;
    const row = db.get<{ node_key: string }>(
      `SELECT node_key AS "nodeKey" FROM nodes WHERE id=$1 AND flow_id=$2`,
      nodeId,
      flowId,
    );
    return row?.nodeKey;
  }

  private lifecycleData(
    flowId: string,
    nodeId: string | null | undefined,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const nodeKey = this.nodeKeyFor(flowId, nodeId);
    if (!nodeKey && !extra) return undefined;
    return { ...(extra ?? {}), ...(nodeKey ? { nodeKey } : {}) };
  }

  /**
   * Warm-up heartbeat: stamp the attributed node's `updated_at` each time an
   * ensure step emits activity. A first-checkout ensure (`git worktree add` +
   * the bounded deps copy) runs for minutes with no agent run row yet, and
   * Reconciler's START_GRACE keys on `updated_at` — without the stamps the
   * reconciler fails the live node as "left running without an active run"
   * (the same aliveness contract the pipeline gate's per-poll stamps follow).
   */
  async private touchNode(flowId: string, nodeId: string | null | undefined): void {
    if (!nodeId) return;
    await db.run(`UPDATE nodes SET updated_at=$1 WHERE id=$2 AND flow_id=$3`, db.now(), nodeId, flowId);
  }

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
      async // repo opted out: run in the registered checkout itself. A worktree left
      // over from before the toggle flip is removed (branch kept) so the
      // binding, sweep and status badge all agree on "no worktree".
      if (flow.worktreeDir) {
        await this.removeFlowWorktree(flow.id, {
          reason: "worktrees disabled for this repo",
        });
        flow.worktreeDir = null;
      }
      const dir = this.tryRealpath(hub);
      await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
        `running in the registered checkout (${dir}) — worktrees disabled`,
        this.lifecycleData(flow.id, opts.nodeId, { branch }));
      this.touchNode(flow.id, opts.nodeId);
      return { dir, setupNote: null };
    }

    const dir = this.worktreeDirForFlow(flow.id);
    // visibility: the ensure can run for minutes on a first checkout — surface
    // it in the node's activity feed immediately instead of leaving the node
    // silent until the create/reuse outcome lands
    await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
      `setting up worktree (branch ${branch})…`,
      this.lifecycleData(flow.id, opts.nodeId, { branch }));
    this.touchNode(flow.id, opts.nodeId);
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
      const canonical = this.tryRealpath(dir);
      if (!flow.worktreeDir || !samePath(flow.worktreeDir, canonical)) {
        await db.run(`UPDATE flows SET worktree_dir=$1, updated_at=$2 WHERE id=$3`, canonical, db.now(), flow.id);
        flow.worktreeDir = canonical;
      }
      await db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
        result.reused
          ? `worktree reused at ${canonical} (branch ${result.headBranch})`
          : `worktree created at ${canonical} (branch ${branch} off ${result.base})`,
        this.lifecycleData(flow.id, opts.nodeId, {
          worktree: canonical,
          branch,
          base: result.base ?? undefined,
        }));
      this.touchNode(flow.id, opts.nodeId);
      // deps setup runs once per flow (the worktree persists build → fixes →
      // re-gates → resolve, including session resumes); reuse skips it
      const setupNote = result.reused
        ? null
        : await this.setupFlowWorktree(ctx, { dir: canonical, hub, nodeId: opts.nodeId ?? null });
      return { dir: canonical, setupNote };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.emitEvent(flow.id, opts.nodeId ?? null, "error",
        `worktree setup failed (${msg})`,
        this.lifecycleData(flow.id, opts.nodeId));
      // fatal: agent runs must never fall back to the registered checkout —
      // they would mutate the developer's real checkout and cross-contaminate
      // concurrent flows. The node fails loudly; retry once fixed.
      throw new Error(
        `worktree setup failed: ${msg} — fix the worktree configuration and retry the node`
      );
    }
  }

  // ── runner ensure (Option B) ────────────────────────────────────────────────

  /** One in-flight ensure per flow — concurrent callers share the work. */
  private ensureInFlight = new Map<string, Promise<WorktreeBinding>>();

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
        this.touchNode(ctx.flow.id, opts.nodeId ?? null);
        const head = await this.currentWorktreeBranch(ctx);
        if (head === desiredBranch && ctx.flow.worktreeDir) {
          const dir = this.tryRealpath(ctx.flow.worktreeDir);
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

  // ── dependency setup (Phase 2) ─────────────────────────────────────────────

  /**
   * Run the repo's dependency-setup policy in a freshly created worktree.
   * Emits a lifecycle event like any other step ("setting up worktree deps…"),
   * is time-bounded by the policy, and FAILS NON-FATALLY: the returned note
   * ("worktree deps setup failed: <err>") goes on the agent's run prompt so
   * the agent can self-repair by running the repo's setup itself.
   */
  private async setupFlowWorktree(
    ctx: FlowCtx,
    target: { dir: string; hub: string; nodeId: string | null }
  ): Promise<string | null> {
    const overrides = this.depOverrides(ctx.repo);
    const policy = depPolicies.resolve({
      hubPath: target.hub,
      overrides,
    });
    await db.emitEvent(ctx.flow.id, target.nodeId, "lifecycle",
      `setting up worktree deps (${policy.source})…`,
      this.lifecycleData(ctx.flow.id, target.nodeId, {
        policy: policy.source,
        strategy: policy.strategy,
      }));
    this.touchNode(ctx.flow.id, target.nodeId);
    const note = (err: string) => `worktree deps setup failed: ${err}`;
    try {
      const result = await worktreeSetup.run({
        hubPath: target.hub,
        worktreePath: target.dir,
        policy,
        syncGlobs: depPolicies.resolveSyncGlobs(overrides),
        sharedDirs: depPolicies.parsePathList(overrides.sharedDirs),
        setupCommand: overrides.setupCommand ?? null,
        onEvent: (message) => {
          await db.emitEvent(ctx.flow.id, target.nodeId, "log", message,
            this.lifecycleData(ctx.flow.id, target.nodeId));
          this.touchNode(ctx.flow.id, target.nodeId);
        },
      });
      const message = result.ok
        ? `worktree deps ready${result.actions.length ? `: ${result.actions.join("; ")}` : ""}`
        : note(result.error ?? "unknown error");
      await db.emitEvent(ctx.flow.id, target.nodeId, result.ok ? "lifecycle" : "error", message,
        this.lifecycleData(ctx.flow.id, target.nodeId, { actions: result.actions }));
      this.touchNode(ctx.flow.id, target.nodeId);
      return result.ok ? null : message;
    } catch (e: unknown) {
      // the executor reports failures as results — a throw here is a bug
      const msg = e instanceof Error ? e.message : String(e);
      await db.emitEvent(ctx.flow.id, target.nodeId, "error", note(msg), this.lifecycleData(ctx.flow.id, target.nodeId));
      return note(msg);
    }
  }

  /** The repo's worktree opt-out (`repos.useWorktrees = 0`); on when unset. */
  private worktreesEnabled(repo: Repo | null | undefined): boolean {
    if (!repo) return true;
    return Boolean(repo.useWorktrees);
  }

  /** The repo row's policy overrides, normalized for the pure dep-policy layer. */
  private depOverrides(repo: Repo | null | undefined): RepoDepOverrides {
    if (!repo) return {};
    return {
      install_command: repo.installCommand,
      skip_install: Boolean(repo.skipInstall),
      setup_command: repo.setupCommand,
      sync_paths: repo.syncPaths,
      shared_dirs: repo.sharedDirs,
    };
  }

  // ── removal ────────────────────────────────────────────────────────────────

  /**
   * Remove a flow's worktree (flow terminal state / flow deletion). No-op when
   * the flow has none. Public so future terminal-state hooks can call it.
   */
  async removeFlowWorktree(
    flowId: string,
    opts: { deleteBranch?: boolean; reason?: string } = {}
  ): Promise<void> {
    const flow = db.get<{ worktree_dir: string | null; mr_branch: string | null; repo_id: string | null }>(
      `SELECT worktree_dir AS "worktreeDir", mr_branch AS "mrBranch",, repo_id AS "repoId" FROM flows WHERE id=$1`, flowId
    );
    if (!flow?.worktreeDir) return;
    const repo = flow.repoId ? await db.repoById(flow.repoId) : null;
    await this.removeWorktreeDir({
      flowId,
      repoPath: repo?.localPath ?? null,
      wtPath: flow.worktreeDir,
      branch: flow.mrBranch,
      deleteBranch: opts.deleteBranch ?? false,
      reason: opts.reason,
    });
  }

  // ── startup sweep ──────────────────────────────────────────────────────────

  /**
   * One-time sweep at server start (runs from the poller's lazy start):
   *  1. resume interrupted removals (crash-safe records)
   *  2. per hub: `git worktree prune`, then reconcile every DevFlow-owned
   *     worktree against its flow — remove dirs whose flow is terminal or gone,
   *     or that the flow no longer points at; adopt dirs the flow owns but
   *     whose column write was lost to a crash
   *  3. unregistered linked-worktree leftovers (`.git` FILE — full clones used
   *     for cloud-mode diffs have a `.git` DIRECTORY and are never touched)
   *
   * Listing failures are strict per repo: the repo is skipped with a warning —
   * a failed scan must never be treated as an authoritative empty list.
   */
  async sweepWorktrees(): Promise<void> {
    // 1. resume recorded removals
    for (const rec of await rows.all(
      WorktreeRemovalRow,
      `SELECT id, flow_id AS "flowId", repo_path AS "repoPath", path, branch, delete_branch AS "deleteBranch", reason, created_at AS "createdAt" FROM worktree_removals ORDER BY created_at`,
    )) {
      try {
        await this.removeWorktreeDir({
          flowId: rec.flowId,
          repoPath: rec.repoPath,
          wtPath: rec.path,
          branch: rec.branch,
          deleteBranch: !!rec.deleteBranch,
          reason: rec.reason ?? "interrupted removal (resumed at startup)",
          recordId: rec.id,
        });
      } catch (e: unknown) {
        console.warn(`worktree sweep: removal resume failed for ${rec.path}: ${e instanceof Error ? e.message : e}`);
      }
    }

    const wsDir = this.tryRealpath(workspacePaths.worktreesRoot());
    const handled = new Set<string>();
    const repos = db.all<Repo>(`SELECT id, name, cloud_url AS "cloudUrl", local_path AS "localPath", default_branch AS "defaultBranch", use_worktrees AS "useWorktrees", install_command AS "installCommand", skip_install AS "skipInstall", sync_paths AS "syncPaths", shared_dirs AS "sharedDirs", setup_command AS "setupCommand", worktree_timeout_ms AS "worktreeTimeoutMs", created_at AS "createdAt", updated_at AS "updatedAt" FROM repos WHERE local_path IS NOT NULL`);

    // 2. reconcile registered worktrees against flows
    for (const repo of repos) {
      if (!repo.localPath) continue;
      try {
        await worktrees.pruneWorktrees(repo.localPath);
        const registered = await worktrees.listWorktrees(repo.localPath);
        for (const wt of registered) {
          if (wt.isMainWorktree || wt.isBare) continue;
          if (!containsPath(this.tryRealpath(workspacePaths.worktreesRoot()), wt.path)) continue; // DevFlow-owned worktrees only
          handled.add(this.tryRealpath(wt.path));
          const flowId = path.basename(wt.path);
          const flow = db.get<{ id: string; status: string; worktree_dir: string | null }>(
            `SELECT id, status, worktree_dir AS "worktreeDir" FROM flows WHERE id=$1`, flowId
          );
          const branch = worktreeBranchName(wt);
          if (!flow) {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow no longer exists",
            });
          } else if (flow.status !== "active") {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: `flow is ${flow.status}`,
            });
          } else if (flow.worktreeDir && !samePath(flow.worktreeDir, wt.path)) {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow points at a different worktree",
            });
          } else if (!flow.worktreeDir) {
            // crash between create and the column write — adopt the worktree
            await db.run(`UPDATE flows SET worktree_dir=$1, updated_at=$2 WHERE id=$3`, wt.path, db.now(), flow.id);
          }
        }
      } catch (e: unknown) {
        // strict failure — skip this repo entirely, never prune based on a broken scan
        console.warn(`worktree sweep skipped repo ${repo.localPath}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 3. unregistered leftovers under the workspace dir
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(wsDir);
    } catch {
      return;
    }
    for (const name of entries) {
      const dir = path.join(wsDir, name);
      const dotGit = path.join(dir, ".git");
      try {
        if (!fs.lstatSync(dotGit).isFile()) continue; // full clone (cloud diff dir) — not a worktree
      } catch {
        continue;
      }
      if (handled.has(this.tryRealpath(dir))) continue;
      const flow = db.get<{ status: string }>(`SELECT status FROM flows WHERE id=$1`, name);
      if (flow && flow.status === "active") continue; // conservative: an active flow may still adopt it
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e: unknown) {
        console.warn(`worktree sweep: could not remove leftover ${dir}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Remove one worktree dir with the full safety gate: workspace containment,
   * dangerous-path refusal, crash-safe record, git removal (fs fallback), then
   * the flows.worktreeDir clear + record cleanup on success.
   */
  private async removeWorktreeDir(target: RemovalTarget): Promise<boolean> {
    const wsDir = this.tryRealpath(workspacePaths.worktreesRoot());
    // Safety net — only ever touch dirs inside the DevFlow workspace root, and
    // never the workspace root itself, the hub, or the user's home.
    if (!containsPath(wsDir, target.wtPath) || samePath(wsDir, target.wtPath)) {
      console.warn(`worktree-lifecycle: refusing removal outside the workspace dir: ${target.wtPath}`);
      return false;
    }
    if (target.repoPath && isDangerousWorktreeRemovalPath(target.wtPath, target.repoPath, os.homedir())) {
      console.warn(`worktree-lifecycle: refusing dangerous removal path: ${target.wtPath}`);
      return false;
    async }

    const recordId = target.recordId ?? db.uid("wtrem_");
    if (!target.recordId) {
      await db.run(
        `INSERT INTO worktree_removals (id, flow_id, repo_path, path, branch, delete_branch, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        recordId, target.flowId, target.repoPath, target.wtPath, target.branch,
        target.deleteBranch ? 1 : 0, target.reason ?? null, db.now()
      );
    }

    let done = false;
    const repoPath = target.repoPath;
    const hubUsable = !!repoPath && fs.existsSync(path.join(repoPath, ".git"));
    if (hubUsable && repoPath) {
      try {
        await worktrees.removeWorktree({
          repoPath,
          wtPath: target.wtPath,
          home: os.homedir(),
          force: true, // terminal-state cleanup; the work product lives on the pushed MR branch
          deleteBranch: target.deleteBranch,
        });
        done = true;
      } catch (e: unknown) {
        // record survives — the next sweep resumes the interrupted removal
        console.warn(`worktree-lifecycle: removal of ${target.wtPath} deferred: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      // hub gone: the worktree can no longer talk to an object database — plain delete
      try {
        fs.rmSync(target.wtPath, { recursive: true, force: true });
        done = true;
      } catch (e: unknown) {
        console.warn(`worktree-lifecycle: could not delete orphaned dir ${target.wtPath}: ${e instanceof Error ? e.message : e}`);
      async }
    }

    if (done) {
      await db.run(`DELETE FROM worktree_removals WHERE id=$1`, recordId);
      if (target.flowId && await db.get(`SELECT 1 FROM flows WHERE id=$1`, target.flowId)) {
        // clear the pointer only when it still names this worktree (a restarted
        // flow may have moved on); compare symlink-tolerantly — git canonicalizes
        async const stored = db.get<{ worktree_dir: string | null }>(
          `SELECT worktree_dir AS "worktreeDir" FROM flows WHERE id=$1`, target.flowId
        )?.worktreeDir ?? null;
        if (stored && samePath(stored, target.wtPath)) {
          await db.run(`UPDATE flows SET worktree_dir=NULL, updated_at=$1 WHERE id=$2`, db.now(), target.flowId);
        }
        const branchNote = target.branch ? ` (branch ${target.branch} kept)` : "";
        await db.emitEvent(target.flowId, null, "lifecycle",
          `worktree removed: ${target.wtPath}${branchNote}${target.reason ? ` — ${target.reason}` : ""}`);
      }
    }
    return done;
  }

  private tryRealpath(p: string): string {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  }
}

/** Shared engine manager (one instance per process across module graphs). */
export const worktreeManager = processSingleton("worktreeManager", () => new WorktreeManager());
