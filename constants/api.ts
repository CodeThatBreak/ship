/** Shared actions used for consistent runtime texts across API consumers */
export const WORKFLOW_ACTIONS = {
  SAVE: "save",
  REMOVE: "remove",
  UPDATE: "update",
} as const;

export type ActionKeys = keyof typeof WORKFLOW_ACTIONS;

/**
 * Fallback error copy shared by every mutation wrapper — appended with the
 * HTTP status when a failing response carries no `error` field.
 */
export const FAILED_ACTION = {
  LOAD: "load failed",
  SAVE: "save failed",
  REMOVE: "remove failed",
} as const;

export type FailedAction = (typeof FAILED_ACTION)[keyof typeof FAILED_ACTION];
