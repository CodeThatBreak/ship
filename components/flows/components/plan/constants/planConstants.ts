/**
 * Plan-domain values (§2.7): action names and statuses used by the plan panel,
 * its subcomponents, and the plan checklist.
 */

/** Plan-view UI-reducer actions (the panel's local state, hooks/usePlanUi.ts). */
export const PLAN_UI_ACTION = {
  SELECT_VERSION: 'select_version',
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
 *  string `planTabCaption` emits — one home, not inline JSX. */
export const PLAN_TAB_CAPTION_MAX = 40;
export const PLAN_TAB_CAPTION_REFINED_IN_CHAT = 'refined in chat';
/** Provenance source of a conversational refine — mirrors the engine's
 *  `REFINED_FROM_SOURCE` value (lib/ is server-only; the UI keeps the same
 *  strings per the constants/flow.ts pattern). */
export const PLAN_REFINED_SOURCE_CHAT = 'chat';

/** The plan node key as referenced by the prompt modals. */
export const PLAN_NODE_KEY = 'plan' as const;
