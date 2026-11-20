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
  TEST: "test failed",
} as const;

export type FailedAction = (typeof FAILED_ACTION)[keyof typeof FAILED_ACTION];

/**
 * Typed error codes the API answers with (step 06): a trigger that lost the
 * atomic claim gets 409 `{ code }` instead of a free-text ConflictError —
 * the UI surfaces the skip as friendly copy, not a generic failure.
 */
export const API_ERROR_CODE = {
  SKIPPED_DUPLICATE_TRIGGER: "skipped_duplicate_trigger",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

/** Friendly copy for a skipped duplicate trigger — the node is already
 *  running, so the second trigger was dropped (the skip event lands on the
 *  feed; retrying is unnecessary, not an error). */
export const SKIPPED_DUPLICATE_TRIGGER_COPY =
  "Already running — a duplicate trigger was skipped";
