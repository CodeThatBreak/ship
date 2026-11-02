'use client';
import type { Artifact, Node } from '@/types/flow';
import type { Action } from '../types/action';

import { FLOW_STATUS } from '@/constants/flow';
import { FailureAlert } from './FailureAlert';
import { PlanEmptyHint } from './PlanEmptyHint';
import { PlanRunningState } from './PlanRunningState';
import { ACTION_TYPES } from '../constants/action';

/**
 * The panel's status states: the override — failed / running / nothing-planned
 * — chosen by the node's status. Renders nothing when the plan is open for
 * viewing (approval, done, …), so the container stays state-free.
 */
export function PlanStatusPanel({
  node,
  plans,
  onAction,
}: {
  node: Node;
  plans: Artifact[];
  onAction: (action: Action) => void;
}) {
  const onRetry = () => onAction({ type: ACTION_TYPES.RETRY_AGENT, payload: { nodeKey: node.node_key } });

  const onStop = () => onAction({ type: ACTION_TYPES.CANCEL_AGENT, payload: { nodeKey: node.node_key } });

  if (node.status === FLOW_STATUS.FAILED) return <FailureAlert onRetry={onRetry} />;
  if (node.status === FLOW_STATUS.RUNNING) {
    return <PlanRunningState hasPlans={plans.length > 0} onStop={onStop} />;
  }
  if (node.status === FLOW_STATUS.PENDING && plans.length === 0) return <PlanEmptyHint />;
  return null;
}
