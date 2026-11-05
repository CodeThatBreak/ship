import "server-only";

/** The closed set of per-comment dispositions the resolve contract declares (§2.7). */
export const RESOLVE_COMMENT_ACTION = {
  FIXED: "fixed",
  ANSWERED: "answered",
  WONTFIX: "wontfix",
  SKIPPED: "skipped",
} as const;
export type ResolveCommentAction =
  (typeof RESOLVE_COMMENT_ACTION)[keyof typeof RESOLVE_COMMENT_ACTION];

/** The tuple the zod enum renders from (closes the schema over the constant). */
export const RESOLVE_COMMENT_ACTIONS = [
  RESOLVE_COMMENT_ACTION.FIXED,
  RESOLVE_COMMENT_ACTION.ANSWERED,
  RESOLVE_COMMENT_ACTION.WONTFIX,
  RESOLVE_COMMENT_ACTION.SKIPPED,
] as const;

export { RESOLVED_BY_AGENT } from "../../../../constants/vocabulary";
