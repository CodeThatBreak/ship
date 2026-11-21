import "server-only";

/** The tool-call count a `transcript` artifact keeps (use case 8c, task 22):
 *  a long agent run's transcript stays bounded like every other engine cap
 *  (the TASK_PRD_CAP precedent) — the log keeps the FIRST calls in arrival
 *  order and reports the overflow instead of growing unbounded. */
export const TRANSCRIPT_CALL_CAP = 50;

/** The per-call args-preview cap (chars): a transcript entry carries a
 *  redacted PREVIEW of the call's arguments, never the payload itself —
 *  tool results (file contents, command output) are not recorded at all. */
export const TRANSCRIPT_SUMMARY_CAP = 200;
