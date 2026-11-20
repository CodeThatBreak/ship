import "server-only";

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
