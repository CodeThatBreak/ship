/** The chat panel's main plan tab — the unthreaded whole-plan conversation. */
const MAIN_PLAN_TAB = 'Main plan';

export const REFINE_HINT = "This sub-plan's refinement conversation — refine it further or ask about its steps.";

const MAIN_THREAD_CONFIG = {
  id: 'MAIN_PLAN_TAB',
  label: MAIN_PLAN_TAB,
  // the unthreaded main conversation: the feed keeps the run/event trail, the
  // messages filter and sends match thread=null, not this tab's id
  main: true,
  emptyTitle: `Refine the “${MAIN_PLAN_TAB}” sub-plan`,
  emptyDescription: REFINE_HINT,
};

export { MAIN_THREAD_CONFIG };
