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
