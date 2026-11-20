import "server-only";

import { db } from "@/lib/db/app";
import {
  samePath,
  worktreeBranchName,
  worktrees,
} from "@/lib/git/worktrees";
import { localGit } from "@/lib/git/local";
import { mapPool } from "./utils/mapPool";
import type { FlowWorktreeRow, WorktreeStatusEntry } from "./types/worktreeStatus";

export class WorktreeStatusService {
  /** Concurrent git probes per repo batch — a tuning value, not a correctness number. */
  private static readonly GIT_CONCURRENCY = 8;

  async statusesForActiveFlows(): Promise<Record<string, WorktreeStatusEntry>> {
    const flowRows = (await db.prisma.flow.findMany({
      where: { worktreeDir: { not: null } },
      select: { id: true, worktreeDir: true, mrBranch: true, repoId: true },
    })).filter((f): f is typeof f & { worktreeDir: string } => f.worktreeDir != null);
    const byRepo = new Map<string, FlowWorktreeRow[]>();
    const noRepo: FlowWorktreeRow[] = [];
    for (const f of flowRows) {
      if (!f.repoId) {
        noRepo.push(f);
        continue;
      }
      const bucket = byRepo.get(f.repoId) ?? [];
      bucket.push(f as FlowWorktreeRow);
      byRepo.set(f.repoId, bucket);
    }

    const out: Record<string, WorktreeStatusEntry> = {};
    for (const f of noRepo) {
      out[f.id] = {
        path: f.worktreeDir,
        registered: false,
        reason: "hub checkout missing or unregistered",
      };
    }

    await mapPool([...byRepo.entries()], WorktreeStatusService.GIT_CONCURRENCY, async ([repoId, flows]) => {
      const repo = await db.repoById(repoId);
      if (!repo?.localPath) {
        for (const f of flows) {
          out[f.id] = {
            path: f.worktreeDir,
            registered: false,
            reason: "hub checkout missing or unregistered",
          };
        }
        return;
      }
      const localPath = repo.localPath;
      const baseBranch = repo.defaultBranch || "main";
      let list;
      try {
        list = await worktrees.listWorktrees(localPath);
      } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e);
        for (const f of flows) {
          out[f.id] = { path: f.worktreeDir, registered: false, reason };
        }
        return;
      }

      await mapPool(flows, WorktreeStatusService.GIT_CONCURRENCY, async (flow) => {
        out[flow.id] = await this.statusForFlow(flow, localPath, baseBranch, list);
      });
    });

    return out;
  }

  private async statusForFlow(
    flow: FlowWorktreeRow,
    localPath: string,
    baseBranch: string,
    list: Awaited<ReturnType<typeof worktrees.listWorktrees>>,
  ): Promise<WorktreeStatusEntry> {
    const missing = {
      path: flow.worktreeDir,
      registered: false as const,
      reason: "worktree dir not found",
    };
    const wt = list.find((w) => samePath(w.path, flow.worktreeDir));
    if (!wt) {
      return { ...missing, reason: "not a registered worktree of this repo" };
    }
    const branch = worktreeBranchName(wt);
    try {
      const [dirty, branchState] = await Promise.all([
        worktrees.isWorktreeDirty(wt.path),
        branch
          ? localGit.localBranchState(localPath, branch, baseBranch).catch(() => null)
          : Promise.resolve(null),
      ]);
      return {
        path: wt.path,
        registered: true,
        branch,
        dirty,
        ahead: branchState?.exists ? branchState.commitsAhead : 0,
        behind: branchState?.exists ? branchState.commitsBehind : 0,
        pushed: branchState?.exists ? branchState.pushed : false,
        stat: branchState?.stat ?? "",
        mrBranch: flow.mrBranch,
      };
    } catch (e: unknown) {
      return {
        ...missing,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
