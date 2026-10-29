/** Shared plan-domain types for the plan panel and its subcomponents. */

import type { ExecutionMode, PLAN_ACTION, PLAN_STEP_ACTION, PLAN_STEP_STATUS, PLAN_UI_ACTION } from "../constants";

/** A plan-step row payload sent on save (row id kept so unchanged rows persist). */
export interface PlanStepPayload {
  id?: string;
  title: string;
  detail?: string;
  files: string[];
  branch: string | null;
}

/**
 * A plan action dispatched through the panel contract, as a typed
 * `{ type, payload }` envelope (the positional `(action, payload)` raw
 * dispatcher is adapted into this once, at the panel boundary).
 */
export type PlanFlowAction =
  | { type: (typeof PLAN_ACTION)["RETRY"] | (typeof PLAN_ACTION)["CANCEL"]; payload: { nodeKey: string } }
  | { type: (typeof PLAN_ACTION)["APPROVE"]; payload: { executionOverride?: ExecutionMode } }
  | { type: (typeof PLAN_STEP_ACTION)["SET"]; payload: { stepId: string; status: (typeof PLAN_STEP_STATUS)[keyof typeof PLAN_STEP_STATUS] } }
  | { type: (typeof PLAN_STEP_ACTION)["UPDATE"]; payload: { steps: PlanStepPayload[] } };

/** The plan panel's action dispatcher: one envelope per dispatch. */
export type FlowAction = (action: PlanFlowAction) => void;

/**
 * The plan-view's local UI state (selected version + expanded branch),
 * owned by the `usePlanUi` reducer (hooks/usePlanUi.ts).
 */
export interface PlanUiState {
  selectedId: string | null;
  expandedBranch: string | null;
}

/** The `{ type, payload }` actions the plan-view reducer handles. */
export type PlanUiAction =
  | { type: (typeof PLAN_UI_ACTION)["SELECT_VERSION"]; payload: { id: string | null } }
  | { type: (typeof PLAN_UI_ACTION)["TOGGLE_BRANCH"]; payload: { name: string } }
  | { type: (typeof PLAN_UI_ACTION)["COLLAPSE_BRANCH"] };

/** A branch sub-plan row in `node.output.branches` (plan fan-out, Phase 3A). */
export interface BranchPlan {
  name: string;
  title?: string;
  markdown?: string;
  scope?: string;
  dependsOn?: string[];
  subPlan?: { prompt?: string; steps?: unknown[] } | null;
}
