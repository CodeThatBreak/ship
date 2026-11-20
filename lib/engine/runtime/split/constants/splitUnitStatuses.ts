import "server-only";

/**
 * Per-unit aggregate entry statuses (decision 4): the join publishes one
 * entry per unit in unit order. `blocked` = the unit never started because
 * a dependency failed/skipped/blocked — visible and retryable (retry the
 * blocking unit); it never escalates the consumer's worst-of status by
 * itself (the failed dependency it points at already did).
 */
export const SPLIT_UNIT_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "skipped",
  "blocked",
] as const;
