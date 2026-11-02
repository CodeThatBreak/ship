import "server-only";

import type { PlanStepRow } from '../../../../../db/rows';
import type { PlanBranch, PlanMeta } from '../schema';

/**
 * The latest plan artifact row + its parsed meta. Every scoped variable and
 * split unit comes from THIS artifact's meta, never from other versions (§2).
 */
export interface LatestPlan {
  art: { id: string; version: number; content: string };
  meta: PlanMeta;
  /** the artifact meta as it was persisted — re-published verbatim on merge */
  rawMeta: Record<string, unknown>;
}

/**
 * Everything {@link PlanStore.scopedRefine} resolved for a branch-scoped
 * refine, or null for the whole-plan path.
 */
export interface ScopedRefine {
  /** the plan version the refine was based on */
  latest: LatestPlan;
  /** the branch being refined */
  branch: PlanBranch;
  /** Live checklist rows for THIS branch — hand edits are part of the
   *  refine's input by construction (§2). */
  liveRows: PlanStepRow[];
}
