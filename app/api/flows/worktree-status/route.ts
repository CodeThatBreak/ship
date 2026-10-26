import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import {
  samePath,
  worktreeBranchName,
  worktrees,
} from "../../../../lib/git/worktrees";
import { localGit } from "../../../../lib/git/local";

export const dynamic = "force-dynamic";

/**
 * Per-flow worktree status for the flow cards (Phase 3 UI): registered-in-git?,
 * branch, dirty, ahead/behind vs the repo's default branch, pushed. One batch
 * endpoint so the cards poll a single cheap request instead of one per flow.
 * Every flow reports independently — one bad repo never blanks the others
 * (list failures are strict, never treated as "no worktrees").
 */
export async function GET() {
  const rows = db.all<{
    id: string;
    worktree_dir: string;
    mr_branch: string | null;
    repo_id: string | null;
  }>(`SELECT id, worktree_dir, mr_branch, repo_id FROM flows WHERE worktree_dir IS NOT NULL`);

  const statuses = await Promise.all(rows.map((f) => statusFor(f)));
  const out: Record<string, unknown> = {};
  for (const s of statuses) out[s.flowId] = s.status;
  return NextResponse.json({ statuses: out });
}

async function statusFor(flow: {
  id: string;
  worktree_dir: string;
  mr_branch: string | null;
  repo_id: string | null;
}) {
  const missing = {
    path: flow.worktree_dir,
    registered: false,
    reason: "worktree dir not found",
  };
  const repo = flow.repo_id ? db.repoById(flow.repo_id) : null;
  if (!repo?.local_path) {
    return {
      flowId: flow.id,
      status: { ...missing, reason: "hub checkout missing or unregistered" },
    };
  }
  // both narrows came from the guard above — capture them once so the
  // callbacks below see plain non-null values (no `!` assertions)
  const localPath: string = repo.local_path;
  try {
    const list = await worktrees.listWorktrees(repo.local_path);
    const wt = list.find((w) => samePath(w.path, flow.worktree_dir));
    if (!wt) {
      return { flowId: flow.id, status: { ...missing, reason: "not a registered worktree of this repo" } };
    }
    const branch = worktreeBranchName(wt);
    const baseBranch = repo.default_branch || "main";
    const [dirty, branchState] = await Promise.all([
      worktrees.isWorktreeDirty(wt.path),
      branch
        ? localGit.localBranchState(localPath, branch, baseBranch).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      flowId: flow.id,
      status: {
        path: wt.path,
        registered: true,
        branch,
        dirty,
        ahead: branchState?.exists ? branchState.commitsAhead : 0,
        behind: branchState?.exists ? branchState.commitsBehind : 0,
        pushed: branchState?.exists ? branchState.pushed : false,
        stat: branchState?.stat ?? "",
        mrBranch: flow.mr_branch,
      },
    };
  } catch (e: unknown) {
    return {
      flowId: flow.id,
      status: {
        ...missing,
        reason: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
