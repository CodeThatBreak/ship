/** The closed set of per-comment dispositions the resolve contract declares
 *  — the client mirror of the engine's `RESOLVE_COMMENT_ACTION` (the client
 *  never imports `lib/`, the REVIEW_VERDICT/pipelineStatus precedent). */
export const RESOLVE_COMMENT_ACTION = {
  FIXED: "fixed",
  ANSWERED: "answered",
  WONTFIX: "wontfix",
  SKIPPED: "skipped",
} as const;

export type ResolveCommentAction = (typeof RESOLVE_COMMENT_ACTION)[keyof typeof RESOLVE_COMMENT_ACTION];

/** Badge color per disposition — fixed/answered read as success, wontfix as
 *  muted, skipped as a warning (the decision needs a human look). */
export const RESOLVE_ACTION_VARIANT: Partial<Record<string, string>> = {
  [RESOLVE_COMMENT_ACTION.FIXED]: "bg-success/10 text-success",
  [RESOLVE_COMMENT_ACTION.ANSWERED]: "bg-success/10 text-success",
  [RESOLVE_COMMENT_ACTION.WONTFIX]: "text-muted-foreground",
  [RESOLVE_COMMENT_ACTION.SKIPPED]: "bg-warning/10 text-warning",
};
