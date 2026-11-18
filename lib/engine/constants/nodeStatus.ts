import "server-only";

import { FLOW_STATUS } from "@/constants/flow";

/**
 * Node / branch build statuses on the engine wire — same values as
 * {@link FLOW_STATUS} for the run-state machine (§2.7). The predicate sets
 * over this vocabulary live in
 * `runtime/transitions/constants/statusSets.ts` (step 02).
 */
export const NODE_STATUS = {
  PENDING: FLOW_STATUS.PENDING,
  WAITING: FLOW_STATUS.WAITING,
  RUNNING: FLOW_STATUS.RUNNING,
  AWAITING_APPROVAL: FLOW_STATUS.AWAITING_APPROVAL,
  APPROVED: FLOW_STATUS.APPROVED,
  DONE: FLOW_STATUS.DONE,
  FAILED: FLOW_STATUS.FAILED,
  SKIPPED: FLOW_STATUS.SKIPPED,
} as const;

export type EngineNodeStatus = (typeof NODE_STATUS)[keyof typeof NODE_STATUS];
