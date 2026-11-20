import "server-only";

/** A flow row carrying its worktree registration — the sweep's input shape. */
export type FlowWorktreeRow = {
  id: string;
  worktreeDir: string;
  mrBranch: string | null;
  repoId: string | null;
};

/** One worktree's live git state as the status route renders it. */
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
