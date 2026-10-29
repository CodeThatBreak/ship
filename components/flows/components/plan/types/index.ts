/** Shared plan-domain types for the plan panel and its subcomponents. */

import type { PLAN_UI_ACTION } from '../constants';

/** A plan-step row payload sent on save (row id kept so unchanged rows persist). */
export interface PlanStepPayload {
  id?: string;
  title: string;
  detail?: string;
  files: string[];
  branch: string | null;
}

export interface PlanUiState {
  selectedId: string | null;
  expandedBranch: string | null;
}

/** The `{ type, payload }` actions the plan-view reducer handles. */
export type PlanUiAction =
  | { type: (typeof PLAN_UI_ACTION)['SELECT_VERSION']; payload: { id: string | null } }
  | { type: (typeof PLAN_UI_ACTION)['TOGGLE_BRANCH']; payload: { name: string } }
  | { type: (typeof PLAN_UI_ACTION)['COLLAPSE_BRANCH'] };

/** A branch sub-plan row in `node.output.branches` (plan fan-out, Phase 3A). */
export interface BranchPlan {
  name: string;
  title?: string;
  markdown?: string;
  scope?: string;
  dependsOn?: string[];
  subPlan?: { prompt?: string; steps?: unknown[] } | null;
}
