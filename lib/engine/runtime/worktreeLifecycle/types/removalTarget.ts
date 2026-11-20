/**
 * One unit of worktree removal (crash-safe): everything the remover needs to
 * gate, record, execute and clean up a single worktree dir. Persisted into
 * `worktree_removals` BEFORE any git runs so a crash resumes at startup sweep.
 */
export interface RemovalTarget {
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
