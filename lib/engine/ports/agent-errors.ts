import "server-only";

import { UpstreamError, ValidationError } from "../../errors";

export class AgentRunLookupError extends UpstreamError {
  constructor(
    message: string,
    readonly runId: string,
    readonly agentId?: string,
  ) {
    super(message);
  }
}

export class AgentRunTimeoutError extends UpstreamError {
  constructor(
    readonly runId: string,
    readonly timeoutMs: number,
  ) {
    super(`Local agent run ${runId} timed out after ${timeoutMs}ms`);
  }
}

export class AgentRunWorkspaceError extends ValidationError {
  constructor() {
    super("Local agent runs require a workspace path (cwd or workspace)");
  }
}
