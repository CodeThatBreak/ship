import "server-only";

import { UpstreamError, ValidationError } from "../../errors";

/** Typed errors for the agent port (target-architecture §12): lookup failures, run timeouts and the missing-workspace validation — what the agent runner surface can reject with, nothing more. Route handlers map them; never throw these outside the agent path. */
export class AgentRunLookupError extends UpstreamError {
  constructor(
    message: string,
    readonly runId: string,
    readonly agentId?: string,
  ) {
    super(message);
  }
}

/** The local agent run exceeded its deadline — the run may still be alive remotely; the caller treats it as failed and lets reconcile/retry decide. */
export class AgentRunTimeoutError extends UpstreamError {
  constructor(
    readonly runId: string,
    readonly timeoutMs: number,
  ) {
    super(`Local agent run ${runId} timed out after ${timeoutMs}ms`);
  }
}

/** A local agent run was requested without a workspace path — configuration error, surfaced before any run starts. */
export class AgentRunWorkspaceError extends ValidationError {
  constructor() {
    super("Local agent runs require a workspace path (cwd or workspace)");
  }
}
