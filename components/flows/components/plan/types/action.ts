import { ACTION_TYPES } from '../constants/action';

import type { PlanStepPayload } from './planTypes';
import type { PlanExecutionMode, PLAN_STEP_STATUS } from '../constants/planConstants';

type RetryAction = {
  type: typeof ACTION_TYPES.RETRY_AGENT;
  payload: { nodeKey: string };
};

type PlanCancelAction = {
  type: typeof ACTION_TYPES.CANCEL_AGENT;
  payload: { nodeKey: string };
};

type ApproveAction = {
  type: typeof ACTION_TYPES.APPROVE;
  payload: { executionOverride?: PlanExecutionMode };
};

type SetPlanStepAction = {
  type: typeof ACTION_TYPES.SET_PLAN_STEP;
  payload: { stepId: string; status: (typeof PLAN_STEP_STATUS)[keyof typeof PLAN_STEP_STATUS] };
};

type UpdatePlanStepsAction = {
  type: typeof ACTION_TYPES.UPDATE_PLAN_STEPS;
  payload: { steps: PlanStepPayload[] };
};

type SelectVersionAction = {
  type: typeof ACTION_TYPES.SELECT_VERSION;
  payload: { id: string | null };
};

type ToggleBranchAction = {
  type: typeof ACTION_TYPES.TOGGLE_BRANCH;
  payload: { name: string };
};

type CollapseBranchAction = {
  type: typeof ACTION_TYPES.COLLAPSE_BRANCH;
};

export type Action =
  | RetryAction
  | PlanCancelAction
  | ApproveAction
  | SetPlanStepAction
  | UpdatePlanStepsAction
  | SelectVersionAction
  | ToggleBranchAction
  | CollapseBranchAction;
