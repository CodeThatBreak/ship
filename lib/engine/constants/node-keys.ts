import "server-only";

/**
 * Stable node keys for the built-in workflow graph.
 * Use these constants instead of string literals so renames stay type-safe.
 */
export const NODE_KEYS = {
  START: "start",
  PLAN: "plan",
  BUILD: "build",
  STEP_BUILD: "step_build",
  PIPELINE: "pipeline",
  REVIEW: "review",
  RESOLVE: "resolve",
} as const;

export type NodeKey = (typeof NODE_KEYS)[keyof typeof NODE_KEYS];

/**
 * The seeded fan-out child template (§5): one plan step built by its own
 * child flow — the build def's default fan-out child. Seeded by `lib/db`
 * (`tpl_step_build`); the build def points here, the step-flow manager
 * resolves it.
 */
export const STEP_BUILD_TEMPLATE_ID = "tpl_step_build";
