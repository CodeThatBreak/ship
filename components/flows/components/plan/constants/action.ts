export const ACTION_TYPES = {
  START: 'start_plan',
  REFINE: 'refine_plan',
  APPROVE: 'approve_plan',
  RETRY_AGENT: 'retry',
  CANCEL_AGENT: 'cancel',

  SET_PLAN_STEP: 'set_plan_step',
  UPDATE_PLAN_STEPS: 'update_plan_steps',

  SELECT_VERSION: 'select_version',
  TOGGLE_BRANCH: 'toggle_branch',
  COLLAPSE_BRANCH: 'collapse_branch',

  BRANCH_REFINE: 'branch_refine',
} as const;
