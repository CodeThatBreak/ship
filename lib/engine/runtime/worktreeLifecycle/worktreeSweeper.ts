import "server-only";

import fs from "fs";
import path from "path";
import { db } from "../../../db/app";
import {
  containsPath,
  samePath,
  worktreeBranchName,
  worktrees,
} from "../../../git/worktrees";
import { workspacePaths } from "../../../git/workspacePaths";
import type { WorktreeRemover } from "./worktreeRemover";
import { realpathOrResolve } from "./utils/realpathOrResolve";

/**
 * WorktreeSweeper — the one-time startup sweep (runs from the poller's lazy
 * start): reconcile the DevFlow-owned worktree dirs on disk against the flows
 * that own them, and resume interrupted removals.
 *
 * Invariants:
 * - crash-safe removals are resumed FIRST (replays `worktree_removals`
 *   through the remover, which re-uses the recorded row).
 * - per hub: `git worktree prune`, then every DevFlow-owned linked worktree
 *   is removed unless an ACTIVE flow owns it (terminal/gone flow, stale
 *   pointer); a flow whose column write was lost to a crash ADOPTS its dir.
 * - unregistered leftovers (`.git` FILE) under the workspace dir are removed
 *   unless an active flow may still adopt them.
 * - listing failures are strict per repo: the repo is skipped with a warning —
 *   a failed scan must never be treated as an authoritative empty list.
 *
 * Must-never: never prune based on a broken scan; never touch a full clone
 * (cloud diff dirs have a `.git` DIRECTORY and are never worktrees); never
 * delete a leftover an active flow could still adopt.
 */
export class WorktreeSweeper {
  constructor(private readonly remover: WorktreeRemover) {}

  async sweepWorktrees(): Promise<void> {
    // 1. resume recorded removals
    for (const rec of await db.prisma.worktreeRemoval.findMany({ orderBy: { createdAt: "asc" } })) {
      try {
        await this.remover.removeWorktreeDir({
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

    const wsDir = realpathOrResolve(workspacePaths.worktreesRoot());
    const handled = new Set<string>();
    const repos = await db.prisma.repo.findMany({ where: { localPath: { not: null } } });

    // 2. reconcile registered worktrees against flows
    for (const repo of repos) {
      if (!repo.localPath) continue;
      try {
        await worktrees.pruneWorktrees(repo.localPath);
        const registered = await worktrees.listWorktrees(repo.localPath);
        for (const wt of registered) {
          if (wt.isMainWorktree || wt.isBare) continue;
          if (!containsPath(realpathOrResolve(workspacePaths.worktreesRoot()), wt.path)) continue; // DevFlow-owned worktrees only
          handled.add(realpathOrResolve(wt.path));
          const flowId = path.basename(wt.path);
          const flow = await db.prisma.flow.findUnique({
            where: { id: flowId }, select: { id: true, status: true, worktreeDir: true } });
          const branch = worktreeBranchName(wt);
          if (!flow) {
            await this.remover.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow no longer exists",
            });
          } else if (flow.status !== "active") {
            await this.remover.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: `flow is ${flow.status}`,
            });
          } else if (flow.worktreeDir && !samePath(flow.worktreeDir, wt.path)) {
            await this.remover.removeWorktreeDir({
              flowId, repoPath: repo.localPath, wtPath: wt.path, branch,
              deleteBranch: true, reason: "flow points at a different worktree",
            });
          } else if (!flow.worktreeDir) {
            // crash between create and the column write — adopt the worktree
            await db.prisma.flow.update({ where: { id: flow.id },
              data: { worktreeDir: wt.path, updatedAt: new Date() } });
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
      if (handled.has(realpathOrResolve(dir))) continue;
      const flow = await db.prisma.flow.findUnique({ where: { id: name }, select: { status: true } });
      if (flow && flow.status === "active") continue; // conservative: an active flow may still adopt it
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e: unknown) {
        console.warn(`worktree sweep: could not remove leftover ${dir}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}
