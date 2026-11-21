import "server-only";

/**
 * The tool-call status classifier the harness agrees on (extracted from
 * `ToolPairer` so the transcript capture labels the same emits terminal):
 * an emit is an END when its status reads completed/failed/… and does not
 * read started/begin/call/invoked. Start-ish statuses pair locally and are
 * not terminal facts.
 */
export const isToolCallEnd = (status: string): boolean =>
  /complete|finish|success|fail|error|result|end/i.test(status)
  && !/start|begin|call|invok/i.test(status);
