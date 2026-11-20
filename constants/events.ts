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
} as const;

export type FlowEventType = (typeof FLOW_EVENT_TYPE)[keyof typeof FLOW_EVENT_TYPE];

/** Plan step / branch merge rollup statuses (STEP_MERGE_STATUSES on the wire). */
export const MERGE_STATUS = {
  RUNNING: "running",
  CONFLICT: "conflict",
  REJECTED: "rejected",
  MERGED: "merged",
  FAILED: "failed",
} as const;

export type MergeStatus = (typeof MERGE_STATUS)[keyof typeof MERGE_STATUS];
