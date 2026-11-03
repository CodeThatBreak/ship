import "server-only";

import { NODE_STATUS, type EngineNodeStatus } from "../../../constants/nodeStatus";
import type { PlanInput } from "./schema";

/** Lifecycle copy when retry clears a failed plan with no turn to replay. */
export const PLAN_CHAT_READY_LIFECYCLE = "plan chat is ready — send a message to continue";

const REVERT_SKIP_STATUSES: ReadonlySet<string> = new Set([
  NODE_STATUS.RUNNING,
  NODE_STATUS.FAILED,
]);

const isRevertCandidate = (status: string): status is EngineNodeStatus =>
  !REVERT_SKIP_STATUSES.has(status) &&
  (Object.values(NODE_STATUS) as readonly string[]).includes(status);

/**
 * Status to restore after a reply-only or refused apply. When the engine has
 * already claimed the node (`running`), read the prior snapshot's
 * `previousStatus` instead of the live row.
 */
export const resolvePlanTurnPreviousStatus = (
  liveStatus: string,
  priorInput: PlanInput | null,
): EngineNodeStatus => {
  if (liveStatus !== NODE_STATUS.RUNNING) {
    return isRevertCandidate(liveStatus) ? liveStatus : NODE_STATUS.PENDING;
  }
  const prev = priorInput?.previousStatus?.trim();
  if (prev && isRevertCandidate(prev)) {
    return prev;
  }
  return NODE_STATUS.PENDING;
};

/**
 * Target node status when retry finds no recorded plan turn (orphan / start
 * failure): honor `previousStatus` when safe, else `awaiting_approval` when a
 * plan artifact exists, otherwise `pending`.
 */
export const resolvePlanFailedRetryStatus = (
  recorded: PlanInput,
  hasPublishedPlan: boolean,
): EngineNodeStatus => {
  const prev = recorded.previousStatus?.trim();
  if (prev && isRevertCandidate(prev)) {
    return prev;
  }
  return hasPublishedPlan ? NODE_STATUS.AWAITING_APPROVAL : NODE_STATUS.PENDING;
};
