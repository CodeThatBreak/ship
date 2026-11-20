import "server-only";

/**
 * Where a trigger came from (step 06, Invariant 11) — recorded on the
 * `skipped_duplicate_trigger` event's data so the feed can group identical
 * skips per source (the webhook + poller race on every pipeline failure
 * emits one skip per losing source, never a silent return).
 */
export const TRIGGER_SOURCE = {
  UI: "ui",
  WEBHOOK: "webhook",
  POLLER: "poller",
  SCHEDULE: "schedule",
  EFFECT: "effect",
} as const;
