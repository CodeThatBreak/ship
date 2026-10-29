'use client';
import type { Artifact, Node } from '@/types/flow';
import { MasterPlanSection } from './masterPlanSection/MasterPlanSection';
import { SubPlanSection } from './subPlanSection/SubPlanSection';

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
  canRefine,
  onToggle,
  onRefine,
}: {
  node: Node;
  /** the plan version artifacts — flowed down for the sub-plan provenance reads */
  plans: Artifact[];
  /** the selected plan version's id (no version → no section) */
  planId: string | null;
  /** the plan version currently being viewed (the sub-plan staleness anchor, §8) */
  viewedVersion: number;
  expandedBranch: string | null;
  canRefine: boolean;
  onToggle: (name: string) => void;
  onRefine: (name: string) => void;
}) {
  if (!planId) return null;

  return (
    <div>
      <MasterPlanSection planId={planId} />

      {/* level 2 — nested under the master plan to show hierarchy */}
      <div className="ml-4 pl-4 border-l border-border">
        <SubPlanSection
          node={node}
          plans={plans}
          viewedVersion={viewedVersion}
          expandedBranch={expandedBranch}
          canRefine={canRefine}
          onToggle={onToggle}
          onRefine={onRefine}
        />
      </div>
    </div>
  );
}
