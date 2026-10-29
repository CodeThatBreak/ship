'use client';
import type { Artifact, Node } from '@/types/flow';
import { FLOW_STATUS } from '@/constants/flow';
import { FailureAlert } from './FailureAlert';
import { PlanEmptyHint } from './PlanEmptyHint';
import { PlanRunningState } from './PlanRunningState';

/**
 * The panel's status states: the override — failed / running / nothing-planned
 * — chosen by the node's status. Renders nothing when the plan is open for
 * viewing (approval, done, …), so the container stays state-free.
 */
export function PlanStatusPanel({
  node,
  plans,
  onRetry,
  onStop,
}: {
  node: Node;
  plans: Artifact[];
  onRetry: () => void;
  onStop: () => void;
}) {
  if (node.status === FLOW_STATUS.FAILED) return <FailureAlert onRetry={onRetry} />;
  if (node.status === FLOW_STATUS.RUNNING) {
    return <PlanRunningState hasPlans={plans.length > 0} onStop={onStop} />;
  }
  if (node.status === FLOW_STATUS.PENDING && plans.length === 0) return <PlanEmptyHint />;
  return null;
}
