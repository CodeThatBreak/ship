import "server-only";

/**
 * Reconciler timing budgets (step 03). The `updated_at`-as-heartbeat
 * heuristics (START_GRACE_MS / PIPELINE_STAMP_FRESH_MS) are gone — node
 * liveness is `lease_until > now()`. This constant is a DIFFERENT thing: the
 * step-merge arena has no lease column, so an in-flight merge-back (owned by
 * whichever process is executing it, guarded there by `mergeArena`) is
 * considered alive while its `step_merges` row stays fresh. The merge-fix
 * budget bounds how long that can legitimately take.
 */
export const STEP_MERGE_GRACE_MS = 180_000;
