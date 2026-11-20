import "server-only";

/**
 * The pipeline gate's durable wait progress (step 05, Invariant 9): the
 * wait-loop state that used to live in in-process locals — a restart resumes
 * the gate from this instead of discarding it. Persisted as `gate_progress`
 * artifact meta, Zod-validated on both write and read (`GateProgressSchema`).
 */

/** Per-pipeline manual-job play state (how often we pressed play, whether we
 *  already warned that nothing was playable). */
export interface GateManualPlayState {
  plays: number;
  warned: boolean;
}

export interface GateProgress {
  /** the pipeline id the loop currently watches (null = re-read the head) */
  watchedId: number | null;
  /** "<id>:<status>" of the last pipeline seen — event dedup + timeout output */
  lastSeen: string | null;
  /** pipelines we already ran a fix for — they must not re-enter the fix loop */
  fixedIds: number[];
  /** one API trigger per "no pipeline" episode */
  triggerAttempted: boolean;
  /** epoch ms when a fix push completed — grace before an API trigger */
  fixWaitStart: number | null;
  /** per-pipeline manual-job play state (keyed by pipeline id) */
  manualPlays: Record<string, GateManualPlayState>;
  /** fix runs spent so far (the bounded budget) */
  fixes: number;
  /** epoch ms of the ORIGINAL deadline — a resume keeps it (a crash-loop
   *  must not reset the 80-minute window each time) */
  deadlineAt: number | null;
}
