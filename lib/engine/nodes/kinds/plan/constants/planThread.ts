/** Main plan tab id in the UI — maps to an unthreaded whole-plan send. */
export const MAIN_PLAN_THREAD_TAB_ID = 'MAIN_PLAN_TAB';

export const normalizePlanThread = (thread?: string | null): string | null => {
  const trimmed = thread?.trim();
  if (!trimmed) return null;
  if (trimmed === MAIN_PLAN_THREAD_TAB_ID) return null;
  return trimmed;
};
