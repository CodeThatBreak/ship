/**
 * Flow feed event types the UI compares against (§2.7). Mirrors the engine's
 * `EVENT_KIND` vocabulary without importing server-only modules.
 */
export const FLOW_EVENT_TYPE = {
  LIFECYCLE: "lifecycle",
  ERROR: "error",
  MR_FAILED: "mr_failed",
  PIPELINE: "pipeline",
  LOG: "log",
  ASSISTANT: "assistant",
  TOOL: "tool",
  STATUS: "status",
  /** the node's materialized input missed its declared upstream needs (step 04) */
  INPUT_CONTRACT_VIOLATION: "input_contract_violation",
  /** a terminal outcome failed its declared output contract — never published (step 04) */
  OUTPUT_CONTRACT_VIOLATION: "output_contract_violation",
  /** the agent-output pipeline retries a contract miss with feedback (step 05) */
  OUTPUT_RETRY: "output_retry",
  /** the bounded feedback budget is spent — the node fails loudly (step 05) */
  OUTPUT_EXHAUSTED: "output_exhausted",
  /** the agent answered with the standard error envelope — never retried (step 05) */
  AGENT_REPORTED: "agent_reported",
  /** a trigger lost the atomic claim — the node was already running (step 06) */
  SKIPPED_DUPLICATE_TRIGGER: "skipped_duplicate_trigger",
  /** a not-yet-started node's config snapshot was edited in-flow (task 05) —
   *  `data.changedKeys` names what the edit touched */
  CONFIG_UPDATED: "config_updated",
  /** a declared effect verb refused: the fact it requires was never
   *  established (task 11) — `data` names `{verb, fact}` */
  EFFECT_CONTRACT_VIOLATION: "effect_contract_violation",
} as const;

export type FlowEventType = (typeof FLOW_EVENT_TYPE)[keyof typeof FLOW_EVENT_TYPE];

/**
 * Optional grouping key stamped into event data by emitters that know their
 * events belong together even when the work spans gaps longer than the
 * activity feed's run-section heuristic (e.g. worktree setup → created →
 * deps ready). The feed keeps every event with the same group + node in one
 * section instead of scattering them across several "<node> activity" blocks.
 */
export const ACTIVITY_GROUP = {
  WORKTREE: "worktree",
} as const;

export type ActivityGroup = (typeof ACTIVITY_GROUP)[keyof typeof ACTIVITY_GROUP];

/** Section heading shown for each activity group. */
export const ACTIVITY_SECTION_LABEL: Record<ActivityGroup, string> = {
  [ACTIVITY_GROUP.WORKTREE]: "Worktree related",
};

/** Plan step / branch merge rollup statuses (STEP_MERGE_STATUSES on the wire). */
export const MERGE_STATUS = {
  RUNNING: "running",
  CONFLICT: "conflict",
  REJECTED: "rejected",
  MERGED: "merged",
  FAILED: "failed",
} as const;

export type MergeStatus = (typeof MERGE_STATUS)[keyof typeof MERGE_STATUS];
