/** The plan node's primary views. Order matches the tab strip. */
export const PLAN_VIEW = {
  PLAN: 'plan',
  STEPS: 'steps',
  USAGE: 'usage',
} as const;

export type PlanView = (typeof PLAN_VIEW)[keyof typeof PLAN_VIEW];
