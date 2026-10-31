import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { workspacePaths } from "../../git/workspace-paths";
import { db, type Repo } from "../../db";
import { processSingleton } from "../../singleton";
import {
  containsPath,
  isDangerousWorktreeRemovalPath,
  samePath,
  worktrees,
  worktreeBranchName,
} from "../../git/worktrees";
import { depPolicies, type RepoDepOverrides } from "../../git/dep-policy";
import { worktreeSetup } from "../../git/worktree-setup";
import type { FlowCtx } from "../nodes/shared/run-context";

/**
 * A crash-safe removal record, persisted BEFORE any git command runs: git
 * drops a worktree's registration even when the directory delete fails, so a
 * naive flow would lose the leftover forever. The startup sweep resumes these.
 */
interface WorktreeRemovalRecord {
  id: string;
  flow_id: string | null;
  repo_path: string | null;
  path: string;
  branch: string | null;
  delete_branch: number;
  reason: string | null;
  created_at: string;
}

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
 * `dir` is null ONLY when worktrees don't apply (cloud mode): local mode
 * either binds a worktree or throws — agent runs never fall back to the
 * registered checkout (the developer's checkout must not be mutated).
 */
export interface WorktreeBinding {
  dir: string | null;
  setupNote: string | null;
}

/**
 * Engine-side manager for the pure worktree layer (lib/git/worktrees.ts).
 * Owns the flow ↔ worktree binding (`flows.worktree_dir`), the dependency-setup
 * run (policy resolved from lib/git/dep-policy.ts, executed by
 * lib/git/worktree-setup.ts), crash-safe removal records (persisted BEFORE git
 * runs, resumed by the startup sweep), and the sweep itself. All git mechanics
 * live in the pure class — this class only joins them to db/config state.
 *
 * Layout: each local-mode flow's worktree lives at `workspaces/worktrees/<flowId>` —
 * outside the repo tree (the developer's checkout stays the hub: it owns the
 * object database, refs and config, and is never mutated by agent runs).
 */
export class WorktreeManager {
  /** A flow's worktree dir: `workspaces/worktrees/<flowId>` (unique per flow; sweep-joinable). */
  private worktreeDirForFlow(flowId: string): string {
    return workspacePaths.worktreeDir(flowId);
  }

  // ── create / ensure ────────────────────────────────────────────────────────

  /**
   * Ensure the flow's worktree exists with `branch` checked out and return its
   * binding — `{ dir: null }` only when worktrees don't apply (cloud mode).
   * Creation failure THROWS (fatal to the node): agent runs mutating the
   * developer's registered checkout cross-contaminated concurrent flows, so
   * the old hub fallback was removed — the node fails loudly with the reason
   * and can be retried once fixed. A fresh worktree runs the repo's
   * dependency-setup policy once (per flow, not per run); a setup failure
   * remains non-fatal, surfaced as `setupNote` for the agent's run prompt.
   * Non-null `dir` results are persisted on `flows.worktree_dir` before
   * returning.
   */
  async ensureFlowWorktree(
    ctx: FlowCtx,
    branch: string,
    opts: { nodeId?: string | null } = {}
  ): Promise<WorktreeBinding> {
    const flow = ctx.flow;
    if (flow.execution_mode !== "local") return { dir: null, setupNote: null };
    const hub = ctx.repo?.local_path ?? null;
    if (!hub) {
      throw new Error(
        "This flow runs in local mode but its repo has no local path configured. Set one on the Settings page."
      );
    }

    const dir = this.worktreeDirForFlow(flow.id);
    // visibility: the ensure can run for minutes on a first checkout — surface
    // it in the node's activity feed immediately instead of leaving the node
    // silent until the create/reuse outcome lands
    db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
      `setting up worktree (branch ${branch})…`,
      { nodeKey: opts.nodeId ?? undefined, branch });
    try {
      const result = await worktrees.createWorktree({
        repoPath: hub,
        dir,
        branch,
        base: ctx.repo?.default_branch ?? "main",
        addTimeoutMs: ctx.repo?.worktree_timeout_ms ?? undefined,
      });
      // store the canonical (realpath) spelling — git canonicalizes worktree
      // paths itself (e.g. /var → /private/var on macOS), and sweep/removal
      // matching joins against `git worktree list` output
      const canonical = this.tryRealpath(dir);
      if (!flow.worktree_dir || !samePath(flow.worktree_dir, canonical)) {
        db.run(`UPDATE flows SET worktree_dir=?, updated_at=? WHERE id=?`, canonical, db.now(), flow.id);
        flow.worktree_dir = canonical;
      }
      db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
        result.reused
          ? `worktree reused at ${canonical} (branch ${result.headBranch})`
          : `worktree created at ${canonical} (branch ${branch} off ${result.base})`,
        { nodeKey: opts.nodeId ?? undefined, worktree: canonical, branch, base: result.base ?? undefined });
      // deps setup runs once per flow (the worktree persists build → fixes →
      // re-gates → resolve, including session resumes); reuse skips it
      const setupNote = result.reused
        ? null
        : await this.setupFlowWorktree(ctx, { dir: canonical, hub, nodeId: opts.nodeId ?? null });
      return { dir: canonical, setupNote };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(flow.id, opts.nodeId ?? null, "error",
        `worktree setup failed (${msg})`,
        { nodeKey: opts.nodeId ?? undefined });
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
      (await this.currentWorktreeBranch(ctx)) ?? ctx.flow.mr_branch ?? opts.defaultBranch;

    while (true) {
      const inflight = this.ensureInFlight.get(ctx.flow.id);
      if (inflight) {
        await inflight.catch(() => undefined);
        const head = await this.currentWorktreeBranch(ctx);
        if (head === desiredBranch && ctx.flow.worktree_dir) {
          const dir = this.tryRealpath(ctx.flow.worktree_dir);
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
    const dir = ctx.flow.worktree_dir;
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
    db.emitEvent(ctx.flow.id, target.nodeId, "lifecycle",
      `setting up worktree deps (${policy.source})…`,
      { nodeKey: target.nodeId ?? undefined, policy: policy.source, strategy: policy.strategy });
    const note = (err: string) => `worktree deps setup failed: ${err}`;
    try {
      const result = await worktreeSetup.run({
        hubPath: target.hub,
        worktreePath: target.dir,
        policy,
        syncGlobs: depPolicies.resolveSyncGlobs(overrides),
        sharedDirs: depPolicies.parsePathList(overrides.shared_dirs),
        setupCommand: overrides.setup_command ?? null,
        onEvent: (message) => db.emitEvent(ctx.flow.id, target.nodeId, "log", message,
          { nodeKey: target.nodeId ?? undefined }),
      });
      const message = result.ok
        ? `worktree deps ready${result.actions.length ? `: ${result.actions.join("; ")}` : ""}`
        : note(result.error ?? "unknown error");
      db.emitEvent(ctx.flow.id, target.nodeId, result.ok ? "lifecycle" : "error", message,
        { nodeKey: target.nodeId ?? undefined, actions: result.actions });
      return result.ok ? null : message;
    } catch (e: unknown) {
      // the executor reports failures as results — a throw here is a bug
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(ctx.flow.id, target.nodeId, "error", note(msg), { nodeKey: target.nodeId ?? undefined });
      return note(msg);
    }
  }

  /** The repo row's policy overrides, normalized for the pure dep-policy layer. */
  private depOverrides(repo: Repo | null | undefined): RepoDepOverrides {
    if (!repo) return {};
    return {
      install_command: repo.install_command,
      skip_install: Boolean(repo.skip_install),
      setup_command: repo.setup_command,
      sync_paths: repo.sync_paths,
      shared_dirs: repo.shared_dirs,
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
      `SELECT worktree_dir, mr_branch, repo_id FROM flows WHERE id=?`, flowId
    );
    if (!flow?.worktree_dir) return;
    const repo = flow.repo_id ? db.repoById(flow.repo_id) : null;
    await this.removeWorktreeDir({
      flowId,
      repoPath: repo?.local_path ?? null,
      wtPath: flow.worktree_dir,
      branch: flow.mr_branch,
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
    for (const rec of db.all<WorktreeRemovalRecord>(
      `SELECT * FROM worktree_removals ORDER BY created_at`
    )) {
      try {
        await this.removeWorktreeDir({
          flowId: rec.flow_id,
          repoPath: rec.repo_path,
          wtPath: rec.path,
          branch: rec.branch,
          deleteBranch: !!rec.delete_branch,
          reason: rec.reason ?? "interrupted removal (resumed at startup)",
          recordId: rec.id,
        });
      } catch (e: unknown) {
        console.warn(`worktree sweep: removal resume failed for ${rec.path}: ${e instanceof Error ? e.message : e}`);
      }
    }

    const wsDir = this.tryRealpath(workspacePaths.worktreesRoot());
    const handled = new Set<string>();
    const repos = db.all<Repo>(`SELECT * FROM repos WHERE local_path IS NOT NULL`);

    // 2. reconcile registered worktrees against flows
    for (const repo of repos) {
      if (!repo.local_path) continue;
      try {
        await worktrees.pruneWorktrees(repo.local_path);
        const registered = await worktrees.listWorktrees(repo.local_path);
        for (const wt of registered) {
          if (wt.isMainWorktree || wt.isBare) continue;
          if (!containsPath(this.tryRealpath(workspacePaths.worktreesRoot()), wt.path)) continue; // DevFlow-owned worktrees only
          handled.add(this.tryRealpath(wt.path));
          const flowId = path.basename(wt.path);
          const flow = db.get<{ id: string; status: string; worktree_dir: string | null }>(
            `SELECT id, status, worktree_dir FROM flows WHERE id=?`, flowId
          );
          const branch = worktreeBranchName(wt);
          if (!flow) {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.local_path, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow no longer exists",
            });
          } else if (flow.status !== "active") {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.local_path, wtPath: wt.path, branch,
              deleteBranch: true, reason: `flow is ${flow.status}`,
            });
          } else if (flow.worktree_dir && !samePath(flow.worktree_dir, wt.path)) {
            await this.removeWorktreeDir({
              flowId, repoPath: repo.local_path, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow points at a different worktree",
            });
          } else if (!flow.worktree_dir) {
            // crash between create and the column write — adopt the worktree
            db.run(`UPDATE flows SET worktree_dir=?, updated_at=? WHERE id=?`, wt.path, db.now(), flow.id);
          }
        }
      } catch (e: unknown) {
        // strict failure — skip this repo entirely, never prune based on a broken scan
        console.warn(`worktree sweep skipped repo ${repo.local_path}: ${e instanceof Error ? e.message : e}`);
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
      const flow = db.get<{ status: string }>(`SELECT status FROM flows WHERE id=?`, name);
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
   * the flows.worktree_dir clear + record cleanup on success.
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
    }

    const recordId = target.recordId ?? db.uid("wtrem_");
    if (!target.recordId) {
      db.run(
        `INSERT INTO worktree_removals (id, flow_id, repo_path, path, branch, delete_branch, reason, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
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
      }
    }

    if (done) {
      db.run(`DELETE FROM worktree_removals WHERE id=?`, recordId);
      if (target.flowId && db.get(`SELECT 1 FROM flows WHERE id=?`, target.flowId)) {
        // clear the pointer only when it still names this worktree (a restarted
        // flow may have moved on); compare symlink-tolerantly — git canonicalizes
        const stored = db.get<{ worktree_dir: string | null }>(
          `SELECT worktree_dir FROM flows WHERE id=?`, target.flowId
        )?.worktree_dir ?? null;
        if (stored && samePath(stored, target.wtPath)) {
          db.run(`UPDATE flows SET worktree_dir=NULL, updated_at=? WHERE id=?`, db.now(), target.flowId);
        }
        const branchNote = target.branch ? ` (branch ${target.branch} kept)` : "";
        db.emitEvent(target.flowId, null, "lifecycle",
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
