"use client";
import { GitBranch, Info } from "lucide-react";
import type { BranchPlan } from "./types";
import type { ScopedDiff } from "./branch-diff";
import { BranchPlanCard } from "./BranchPlanCard";

/**
 * Sub-plans (level 2): indented under the main plan to show hierarchy, one
 * card per branch. Carries the staleness note (§8) and the scoped-refine
 * provenance data (§6/§7.3); the toggle/refine callbacks for every card come
 * from the container as stable references.
 */
export function BranchPlanSection({
  branches,
  staleBranches,
  scopedDiff,
  expandedTab,
  canRefine,
  onToggle,
  onRefine,
}: {
  branches: BranchPlan[];
  /** version of the scoped refine newer than the overview, per stale branch (§8) */
  staleBranches: Map<string, number>;
  /** diff banner data when any branch was scoped-refined (null otherwise) */
  scopedDiff: ScopedDiff | null;
  expandedTab: string | null;
  canRefine: boolean;
  onToggle: (name: string) => void;
  onRefine: (name: string) => void;
}) {
  return (
    <div className="ml-4 pl-4 border-l border-border">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
        <GitBranch size={14} /> Sub-plans · {branches.length} branch
        {branches.length > 1 ? "es" : ""}
      </h3>

      {/* staleness note when any branch doc is newer than the overview (§8) */}
      {staleBranches.size > 0 && (
        <p className="text-[11.5px] text-muted-foreground mb-2 flex items-start gap-1.5">
          <Info size={12} className="shrink-0 mt-[1px]" />
          branch sub-plans are more recent than this overview — open a
          sub-plan for its current document
        </p>
      )}

      <div className="grid gap-2">
        {branches.map((b) => (
          <BranchPlanCard
            key={b.name}
            branch={b}
            expanded={expandedTab === b.name}
            scopedDiff={scopedDiff}
            staleVersion={staleBranches.get(b.name)}
            canRefine={canRefine}
            onToggle={onToggle}
            onRefine={onRefine}
          />
        ))}
      </div>
    </div>
  );
}
