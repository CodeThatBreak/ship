'use client';
import { useMemo } from 'react';
import { GitBranch, Info } from 'lucide-react';
import type { Artifact, Node } from '@/types/flow';
import type { BranchPlan } from '../../types';
import { computeScopedDiff, computeStaleBranches } from '../../utils/branchDiff';
import { SubPlanCard } from './SubPlanCard';

/**
 * Sub-plans (level 2): one card per branch of the fanned-out plan, rendered
 * as a child of `PlanSection` — the hierarchy indent lives there, so a branch
 * card visually nests under the master plan it belongs to.
 *
 * The section derives its own view of the fan-out: the branch list comes from
 * `node.output.branches`, and the scoped-refine provenance data (§6/§7.3) plus
 * the staleness map (§8) are computed from the plan version metas — nothing to
 * show renders nothing.
 */
export function SubPlanSection({
  node,
  plans,
  viewedVersion,
  expandedBranch,
  canRefine,
  onToggle,
  onRefine,
}: {
  node: Node;
  /** the plan version artifacts — the source for branch provenance + staleness */
  plans: Artifact[];
  /** the plan version currently being viewed (staleness is measured against it, §8) */
  viewedVersion: number;
  expandedBranch: string | null;
  canRefine: boolean;
  onToggle: (name: string) => void;
  onRefine: (name: string) => void;
}) {
  // Phase 3A: branches from the plan output — a fan-out plan lists one
  // sub-plan per branch; null when not fanned out
  const branches = (node.output?.branches ?? null) as BranchPlan[] | null;
  // scoped-refine diff banner data (§6/§7.3): which branch changed between
  // the two latest versions — computed client-side from the plan metas
  const scopedDiff = useMemo(() => computeScopedDiff(plans), [plans]);
  // staleness (§8): a scoped refine makes its branch doc newer than the
  // overview — measured against the version currently being viewed
  const staleBranches = useMemo(
    () => computeStaleBranches(plans, branches, viewedVersion),
    [branches, plans, viewedVersion]
  );

  if (!branches || branches.length === 0) return null;

  return (
    <>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
        <GitBranch size={14} /> Sub-plans · {branches.length} branch
        {branches.length > 1 ? 'es' : ''}
      </h3>

      {/* staleness note when any branch doc is newer than the overview (§8) */}
      {staleBranches.size > 0 && (
        <p className="text-[11.5px] text-muted-foreground mb-2 flex items-start gap-1.5">
          <Info size={12} className="shrink-0 mt-[1px]" />
          branch sub-plans are more recent than this overview — open a sub-plan for its current document
        </p>
      )}

      <div className="grid gap-2">
        {branches.map(b => (
          <SubPlanCard
            key={b.name}
            branch={b}
            expanded={expandedBranch === b.name}
            scopedDiff={scopedDiff}
            staleVersion={staleBranches.get(b.name)}
            canRefine={canRefine}
            onToggle={onToggle}
            onRefine={onRefine}
          />
        ))}
      </div>
    </>
  );
}
