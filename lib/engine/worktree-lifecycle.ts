import fs from "fs";
import os from "os";
import path from "path";
import { config } from "../config";
import { db, type Repo } from "../db";
import { processSingleton } from "../singleton";
import {
  containsPath,
  isDangerousWorktreeRemovalPath,
  samePath,
  worktrees,
  worktreeBranchName,
} from "../git/worktrees";
import type { FlowCtx } from "./nodes/base/flow-context";

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
 * Engine-side manager for the pure worktree layer (lib/git/worktrees.ts).
 * Owns the flow ↔ worktree binding (`flows.worktree_dir`), crash-safe removal
 * records (persisted BEFORE git runs, resumed by the startup sweep), and the
 * sweep itself. All git mechanics live in the pure class — this class only
 * joins them to db/config state.
 *
 * Layout: each local-mode flow's worktree lives at `workspaces/<flowId>` —
 * outside the repo tree (the developer's checkout stays the hub: it owns the
 * object database, refs and config, and is never mutated by agent runs).
 */
export class WorktreeManager {
  // ── mode switch ────────────────────────────────────────────────────────────

  /** Worktrees are default-on; `worktree_mode: "disabled"` is the kill switch (UI: Phase 3). */
  private worktreeModeEnabled(): boolean {
    return db.getSetting<string>("worktree_mode", "enabled") !== "disabled";
  }

  /** A flow's worktree dir: `workspaces/<flowId>` (unique per flow; sweep-joinable). */
  private worktreeDirForFlow(flowId: string): string {
    return path.join(config.workspace.dir(), flowId);
  }

  // ── create / ensure ────────────────────────────────────────────────────────

  /**
   * Ensure the flow's worktree exists with `branch` checked out and return its
   * path — or null when worktrees don't apply (cloud mode, no registered local
   * path, disabled by setting) or setup failed (non-fatal: callers fall back to
   * the registered checkout, today's behavior). Non-null results are persisted
   * on `flows.worktree_dir` before returning.
   */
  async ensureFlowWorktree(
    ctx: FlowCtx,
    branch: string,
    opts: { nodeId?: string | null } = {}
  ): Promise<string | null> {
    const flow = ctx.flow;
    if (flow.execution_mode !== "local") return null;
    const hub = ctx.repo?.local_path ?? null;
    if (!hub) return null;
    if (!this.worktreeModeEnabled()) return null;

    const dir = this.worktreeDirForFlow(flow.id);
    try {
      const result = await worktrees.createWorktree({
        repoPath: hub,
        dir,
        branch,
        base: ctx.repo?.default_branch ?? "main",
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
      return canonical;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(flow.id, opts.nodeId ?? null, "error",
        `worktree setup failed — running in the registered checkout instead (${msg})`,
        { nodeKey: opts.nodeId ?? undefined });
      return null;
    }
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

    const wsDir = config.workspace.dir();
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
          if (!containsPath(this.tryRealpath(wsDir), wt.path)) continue; // DevFlow-owned worktrees only
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
    const wsDir = this.tryRealpath(config.workspace.dir());
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
    const hubUsable = !!target.repoPath && fs.existsSync(path.join(target.repoPath, ".git"));
    if (hubUsable) {
      try {
        await worktrees.removeWorktree({
          repoPath: target.repoPath!,
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
