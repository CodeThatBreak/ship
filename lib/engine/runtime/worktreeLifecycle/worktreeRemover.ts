import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../../../db/app";
import {
  containsPath,
  isDangerousWorktreeRemovalPath,
  samePath,
  worktrees,
} from "../../../git/worktrees";
import { workspacePaths } from "../../../git/workspacePaths";
import type { RemovalTarget } from "./types/removalTarget";
import { realpathOrResolve } from "./utils/realpathOrResolve";

/**
 * WorktreeRemover — crash-safe removal of a flow's worktree dir.
 *
 * Invariants (durability — durable-but-unfinished, never durable-but-wrong):
 * - the removal record is persisted BEFORE any git runs; a crash resumes at
 *   the startup sweep (the sweeper replays `worktree_removals` rows).
 * - the safety gate runs first: only dirs inside the DevFlow workspace root
 *   are ever touched, and never the workspace root itself, the hub, or the
 *   user's home.
 * - on success the record is deleted and `flows.worktreeDir` is cleared only
 *   when it still names this worktree (a restarted flow may have moved on).
 *
 * Must-never: never delete outside the workspace containment gate; never
 * treat a failed git removal as done (the record survives so the sweep
 * resumes); never remove the branch unless the caller opted in (unmerged
 * commits are the work product).
 */
export class WorktreeRemover {
  /**
   * Remove a flow's worktree (flow terminal state / flow deletion). No-op when
   * the flow has none. Public so future terminal-state hooks can call it.
   */
  async removeFlowWorktree(
    flowId: string,
    opts: { deleteBranch?: boolean; reason?: string } = {}
  ): Promise<void> {
    const flow = await db.prisma.flow.findUnique({
      where: { id: flowId }, select: { worktreeDir: true, mrBranch: true, repoId: true },
    });
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

  /**
   * Remove one worktree dir with the full safety gate: workspace containment,
   * dangerous-path refusal, crash-safe record, git removal (fs fallback), then
   * the flows.worktreeDir clear + record cleanup on success.
   */
  async removeWorktreeDir(target: RemovalTarget): Promise<boolean> {
    const wsDir = realpathOrResolve(workspacePaths.worktreesRoot());
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
      await db.prisma.worktreeRemoval.createMany({
        data: [{
          id: recordId, flowId: target.flowId, repoPath: target.repoPath, path: target.wtPath, branch: target.branch,
          deleteBranch: target.deleteBranch ?? false, reason: target.reason ?? null, createdAt: new Date(),
        }],
        skipDuplicates: true,
      });
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
      await db.prisma.worktreeRemoval.deleteMany({ where: { id: recordId } });
      if (target.flowId && await db.prisma.flow.findUnique({ where: { id: target.flowId }, select: { id: true } })) {
        // clear the pointer only when it still names this worktree (a restarted
        // flow may have moved on); compare symlink-tolerantly — git canonicalizes
        const stored = (await db.prisma.flow.findUnique({
          where: { id: target.flowId }, select: { worktreeDir: true } }))?.worktreeDir ?? null;
        if (stored && samePath(stored, target.wtPath)) {
          await db.prisma.flow.update({ where: { id: target.flowId },
            data: { worktreeDir: null, updatedAt: new Date() } });
        }
        const branchNote = target.branch ? ` (branch ${target.branch} kept)` : "";
        await db.emitEvent(target.flowId, null, "lifecycle",
          `worktree removed: ${target.wtPath}${branchNote}${target.reason ? ` — ${target.reason}` : ""}`);
      }
    }
    return done;
  }
}
