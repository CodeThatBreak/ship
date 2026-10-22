/**
 * Stable node keys for the built-in workflow graph.
 * Use these constants instead of string literals so renames stay type-safe.
 */
export const NODE_KEYS = {
  PLAN: "plan",
  BUILD: "build",
  PIPELINE: "pipeline",
  REVIEW: "review",
  RESOLVE: "resolve",
} as const;

export type NodeKey = (typeof NODE_KEYS)[keyof typeof NODE_KEYS];
