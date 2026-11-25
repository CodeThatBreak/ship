import "server-only";

/**
 * IPC message kinds of the agent host protocol (one child process per local
 * run; see docs/local-agents-in-worker-plan.md). `start`/`cancel` travel
 * parent→child; `started`/`event`/`result`/`error` travel child→parent.
 * `started` is always posted before any `event` — the pipe's ordering is
 * what lets the parent key its per-run event buffer by runId.
 */
export const AGENT_HOST_MESSAGE_KINDS = {
  START: "start",
  CANCEL: "cancel",
  STARTED: "started",
  EVENT: "event",
  RESULT: "result",
  ERROR: "error",
} as const;

export type AgentHostMessageKind = (typeof AGENT_HOST_MESSAGE_KINDS)[keyof typeof AGENT_HOST_MESSAGE_KINDS];
