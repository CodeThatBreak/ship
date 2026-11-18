import "server-only";

/**
 * The `jobs` table vocabulary (engine overhaul step 03, Invariant 7 —
 * target-architecture §3). Every kind here must have a dispatcher registered
 * in the worker's job sweep by the step that first enqueues it:
 *  - `webhook_delivery` — hooks routes + the GitLab webhook route (write-ahead
 *    insert, claim, dispatch, mark done — exactly-once across the crash window)
 *  - `schedule_fire` — the poller's template-schedule sweep enqueues; the
 *    handler fires and advances `schedule_next_at` in the same transaction as
 *    the job's completion
 *  - `wait_fire` / `merge_back` — declared vocabulary; the durable wait sweep
 *    (step 03) claims and fires waits directly through the WaitStore instead,
 *    and merge-backs become jobs with the step-07 coordinator
 */
export const JOB_KIND = {
  WEBHOOK_DELIVERY: "webhook_delivery",
  SCHEDULE_FIRE: "schedule_fire",
  WAIT_FIRE: "wait_fire",
  MERGE_BACK: "merge_back",
} as const;

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

export const JOB_STATUS = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  DONE: "done",
  FAILED: "failed",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/**
 * Retry budget: a failing job requeues with exponential backoff until the
 * attempt cap, then lands `failed` with a typed event — the "GitLab retries
 * forever" path dies here.
 */
export const JOB_LIMITS = {
  MAX_ATTEMPTS: 5,
  /** Claim lease: a `claimed` job whose lease lapses is reclaimable (crash recovery). */
  LEASE_SECONDS: 120,
  /** Requeue backoff base: `run_at = now() + BASE * 2^(attempts - 1)` seconds. */
  BACKOFF_BASE_SECONDS: 30,
} as const;

/** The kinds with a dispatcher registered today (step 03). */
export const DISPATCHABLE_JOB_KINDS: readonly JobKind[] = [
  JOB_KIND.WEBHOOK_DELIVERY,
  JOB_KIND.SCHEDULE_FIRE,
];
