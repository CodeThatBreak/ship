/**
 * Plan-domain values (§2.7): mode/knob values, action names, and statuses used
 * by the plan panel, its subcomponents, and the plan checklist.
 */

/** Fan-out execution modes a plan can publish (plan-meta `execution`). */
export const EXECUTION_MODE = {
  WHOLE: 'whole',
  STEPS: 'steps',
} as const;
export type PlanExecutionMode = (typeof EXECUTION_MODE)[keyof typeof EXECUTION_MODE];

/** The plan node's `execution_default` knob values. */
export const EXECUTION_KNOB = {
  FOLLOW: 'follow',
} as const;

/** executionSource values recorded in plan-meta at approve. */
export const EXECUTION_SOURCE = {
  OVERRIDE: 'override',
} as const;

/** Plan-view UI-reducer actions (the panel's local state, hooks/usePlanUi.ts). */
export const PLAN_UI_ACTION = {
  SELECT_VERSION: 'select_version',
  TOGGLE_BRANCH: 'toggle_branch',
  COLLAPSE_BRANCH: 'collapse_branch',
} as const;

/** Plan-checklist step statuses. */
export const PLAN_STEP_STATUS = {
  DONE: 'done',
  PENDING: 'pending',
} as const;

/** Plan-checklist row provenance values. */
export const PLAN_STEP_ORIGIN = {
  USER: 'user',
} as const;

/** Plan-checklist row completion attribution values. */
export const PLAN_STEP_COMPLETED_BY = {
  BUILD: 'build',
} as const;

/** Version tab caption copy (§6b): the truncation length and the provenance
 *  strings `planTabCaption` (branch-diff.ts) emits — one home, not inline JSX. */
export const PLAN_TAB_CAPTION_MAX = 40;
export const PLAN_TAB_CAPTION_REFINED_IN_CHAT = 'refined in chat';
export const PLAN_TAB_CAPTION_BRANCH_PREFIX = 'branch refine: ';
/** Provenance source of a conversational refine — mirrors the engine's
 *  `REFINED_FROM_SOURCE` value (lib/ is server-only; the UI keeps the same
 *  strings per the constants/flow.ts pattern). */
export const PLAN_REFINED_SOURCE_CHAT = 'chat';

/** The plan node key as referenced by the prompt modals. */
export const PLAN_NODE_KEY = 'plan' as const;
