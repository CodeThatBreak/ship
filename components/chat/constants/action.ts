const ACTION_TYPES = {
  SET_MODEL: 'SET_MODEL',
  /** the conversation switch (the threads seam) — payload carries the new threadId */
  THREAD_CHANGED: 'THREAD_CHANGED',
  DRAFT_CHANGED: 'DRAFT_CHANGED',
  RESET: 'RESET',
} as const;

export { ACTION_TYPES };
