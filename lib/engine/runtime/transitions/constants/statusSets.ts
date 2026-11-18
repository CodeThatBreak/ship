import "server-only";

import { NODE_STATUS } from "../../../constants/nodeStatus";

/**
 * Node status predicate sets (moved from `constants/nodeStatus.ts` in step 02
 * — the sets describe the state machine the transition authority owns, so
 * they live with it). `NODE_STATUS` itself (the vocabulary) stays in
 * `constants/nodeStatus.ts`.
 */

/** Child flow has left idle — work was attempted or reached a terminal state. */
export const NODE_STARTED_STATUSES: readonly string[] = [
  NODE_STATUS.RUNNING,
  NODE_STATUS.AWAITING_APPROVAL,
  NODE_STATUS.FAILED,
  NODE_STATUS.DONE,
  NODE_STATUS.APPROVED,
  NODE_STATUS.SKIPPED,
];

export const isNodeStarted = (status: string): boolean =>
  NODE_STARTED_STATUSES.includes(status);

export const childFlowHasStarted = (statuses: readonly string[]): boolean =>
  statuses.some(isNodeStarted);

/** Terminal success terminals that advance outgoing edges. */
export const NODE_TERMINAL_SUCCESS_STATUSES: readonly string[] = [
  NODE_STATUS.DONE,
  NODE_STATUS.APPROVED,
];

export const isNodeTerminalSuccess = (status: string): boolean =>
  NODE_TERMINAL_SUCCESS_STATUSES.includes(status);

/** Split rollup / aggregate success membership. */
export const NODE_SUCCESS_STATUSES: readonly string[] = [
  NODE_STATUS.DONE,
  NODE_STATUS.APPROVED,
  NODE_STATUS.SKIPPED,
];

export const NODE_TERMINAL_STATUSES: readonly string[] = [
  NODE_STATUS.DONE,
  NODE_STATUS.APPROVED,
  NODE_STATUS.FAILED,
  NODE_STATUS.SKIPPED,
];

export const NODE_ACTIVE_STATUSES: readonly string[] = [
  NODE_STATUS.PENDING,
  NODE_STATUS.RUNNING,
  NODE_STATUS.WAITING,
  NODE_STATUS.AWAITING_APPROVAL,
];

export const NODE_IN_FLIGHT_STATUSES: readonly string[] = [
  NODE_STATUS.RUNNING,
  NODE_STATUS.WAITING,
  NODE_STATUS.AWAITING_APPROVAL,
];

/** Nodes that can still be cancelled mid-flight (skip step, checklist edit). */
export const NODE_CANCELABLE_STATUSES: readonly string[] = [
  NODE_STATUS.RUNNING,
  NODE_STATUS.AWAITING_APPROVAL,
  NODE_STATUS.WAITING,
  NODE_STATUS.PENDING,
];
