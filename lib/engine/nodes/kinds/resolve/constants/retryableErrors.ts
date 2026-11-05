import "server-only";

import {
  AGENT_OUTPUT_ERROR,
  type AgentOutputErrorCode,
} from "../../../shared/agent/outputError/outputErrorExports";

/** Output-contract failures a feedback turn can fix (the plan/agentNode split —
 *  this node owns its own copy, `plan/constants/retryableErrors.ts` precedent).
 *  `agent_reported` never retries — the agent explicitly said it cannot comply. */
const RETRYABLE_OUTPUT_ERRORS: ReadonlySet<AgentOutputErrorCode> = new Set([
  AGENT_OUTPUT_ERROR.NO_JSON,
  AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
]);

export { RETRYABLE_OUTPUT_ERRORS };
