import "server-only";

/** Poll interval while waiting for a pipeline to reach a terminal state (ms). */
export const POLL_MS_DEFAULT = 20_000;

/** Give up waiting (node → failed, retryable) after this long (ms). */
export const WAIT_TIMEOUT_MS_DEFAULT = 80 * 60_000;

/** Max agent fix attempts before failing the node for manual intervention. */
export const MAX_FIX_ATTEMPTS_DEFAULT = 3;

/** Max times we press "play" on manual jobs for one pipeline. */
export const MAX_MANUAL_PLAYS = 20;

/**
 * After a fix push: how long to wait for the push's new pipeline to appear on
 * the MR head before triggering one ourselves (manual-CI projects never start
 * one on push) — long enough for GitLab to attach it, short enough to keep
 * the loop moving when it never comes.
 */
export const FIX_PIPELINE_GRACE_MS = 2 * 60_000;

/** The artifact kind the gate's durable wait progress persists under (the
 *  restart-resume source of truth — step 05, Invariant 9). */
export const GATE_PROGRESS_ARTIFACT = "gate_progress";

/** Prompt template used for fix runs (kept as a customizable template in settings). */
export const FIX_PROMPT_KEY = "pipeline_fix";

/** How many failed jobs' logs the fix prompt assembles (the existing 3×8k budget). */
export const FIX_JOB_LOGS = 3;

/** The per-job log-tail cap the fix prompt assembles. */
export const FIX_JOB_TRACE_TAIL = 8000;
