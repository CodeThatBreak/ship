/** Shared plan-domain types for the plan panel and its subcomponents. */

import type { PLAN_UI_ACTION } from '../constants/planConstants';

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
}

/** The `{ type, payload }` actions the plan-view reducer handles. */
export type PlanUiAction = {
  type: (typeof PLAN_UI_ACTION)['SELECT_VERSION'];
  payload: { id: string | null };
};
