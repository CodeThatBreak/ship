'use client';
import type { Artifact, Node } from '@/types/flow';
import type { Action } from '../types/action';

import { MasterPlanSection } from './masterPlanSection/MasterPlanSection';
import { SubPlanSection } from './subPlanSection/SubPlanSection';
import { ACTION_TYPES } from '../constants/action';

/**
 * The plan document section (levels 1–2): the master plan on top, with the
 * sub-plan branches rendered beneath the leading indent rail — the visible
 * plan → sub-plan hierarchy of a fanned-out plan. Renders nothing without a
 * plan version to show.
 */
export function PlanSection({
  node,
  plans,
  planId,
  viewedVersion,
  expandedBranch,
  onAction,
}: {
  node: Node;
  /** the plan version artifacts — flowed down for the sub-plan provenance reads */
  plans: Artifact[];
  /** the selected plan version's id (no version → no section) */
  planId: string | null;
  /** the plan version currently being viewed (the sub-plan staleness anchor, §8) */
  viewedVersion: number;
  expandedBranch: string | null;

  onAction: (action: Action) => void;
}) {
  const onToggle = (name: string) => {
    onAction({ type: ACTION_TYPES.TOGGLE_BRANCH, payload: { name } });
  };

  if (!planId) return null;

  return (
    <div>
      <MasterPlanSection planId={planId} />

      <div className="ml-4 pl-4 border-l border-border">
        <SubPlanSection
          node={node}
          plans={plans}
          viewedVersion={viewedVersion}
          expandedBranch={expandedBranch}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}
