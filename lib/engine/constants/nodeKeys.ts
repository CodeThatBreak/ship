import "server-only";

/**
 * Stable node keys for the built-in workflow graph.
 * Use these constants instead of string literals so renames stay type-safe.
 */
export const NODE_KEYS = {
  START: "start",
  PLAN: "plan",
  BUILD: "build",
  PIPELINE: "pipeline",
  REVIEW: "review",
  RESOLVE: "resolve",
} as const;

export type NodeKey = (typeof NODE_KEYS)[keyof typeof NODE_KEYS];

/** Built-in SDLC loop flow template seeded at migration user_version 1. */
export const SDLC_TEMPLATE_ID = "tpl_sdlc_loop";
