import "server-only";

import { db } from "@/lib/db";
import {
  samePath,
  worktreeBranchName,
  worktrees,
} from "@/lib/git/worktrees";
import { localGit } from "@/lib/git/local";

const GIT_CONCURRENCY = 8;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

type FlowWorktreeRow = {
  id: string;
  worktree_dir: string;
  mr_branch: string | null;
  repo_id: string | null;
};

export type WorktreeStatusEntry = {
  path: string;
  registered: boolean;
  reason?: string;
  branch?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  pushed?: boolean;
  stat?: string;
  mrBranch?: string | null;
};

export class WorktreeStatusService {
  async statusesForActiveFlows(): Promise<Record<string, WorktreeStatusEntry>> {
    const flowRows = db.all<FlowWorktreeRow>(
      `SELECT id, worktree_dir, mr_branch, repo_id FROM flows WHERE worktree_dir IS NOT NULL`,
    );
    const byRepo = new Map<string, FlowWorktreeRow[]>();
    const noRepo: FlowWorktreeRow[] = [];
    for (const f of flowRows) {
      if (!f.repo_id) {
        noRepo.push(f);
        continue;
      }
      const bucket = byRepo.get(f.repo_id) ?? [];
      bucket.push(f);
      byRepo.set(f.repo_id, bucket);
    }

    const out: Record<string, WorktreeStatusEntry> = {};
    for (const f of noRepo) {
      out[f.id] = {
        path: f.worktree_dir,
        registered: false,
        reason: "hub checkout missing or unregistered",
      };
    }

    await mapPool([...byRepo.entries()], GIT_CONCURRENCY, async ([repoId, flows]) => {
      const repo = db.repoById(repoId);
      if (!repo?.local_path) {
        for (const f of flows) {
          out[f.id] = {
            path: f.worktree_dir,
            registered: false,
            reason: "hub checkout missing or unregistered",
          };
        }
        return;
      }
      const localPath = repo.local_path;
      const baseBranch = repo.default_branch || "main";
      let list;
      try {
        list = await worktrees.listWorktrees(localPath);
      } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e);
        for (const f of flows) {
          out[f.id] = { path: f.worktree_dir, registered: false, reason };
        }
        return;
      }

      await mapPool(flows, GIT_CONCURRENCY, async (flow) => {
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
      path: flow.worktree_dir,
      registered: false as const,
      reason: "worktree dir not found",
    };
    const wt = list.find((w) => samePath(w.path, flow.worktree_dir));
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
        mrBranch: flow.mr_branch,
      };
    } catch (e: unknown) {
      return {
        ...missing,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
