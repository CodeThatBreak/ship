/** The chat panel's main plan tab — the unthreaded whole-plan conversation. */
const MAIN_PLAN_TAB = 'Main plan';

export const REFINE_HINT = "This sub-plan's refinement conversation — refine it further or ask about its steps.";

const MAIN_THREAD_CONFIG = {
  id: 'MAIN_PLAN_TAB',
  label: MAIN_PLAN_TAB,
  emptyTitle: `Refine the “${MAIN_PLAN_TAB}” sub-plan`,
  emptyDescription: REFINE_HINT,
};

export { MAIN_THREAD_CONFIG };
