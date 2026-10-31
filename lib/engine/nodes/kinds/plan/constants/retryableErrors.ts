import "server-only";

import { AGENT_OUTPUT_ERROR, type AgentOutputErrorCode } from '../../../shared/agent/output-error';

/** Output-contract failures a feedback turn can fix: missing or schema-
 *  violating JSON. `agent_reported` never retries — the agent explicitly said
 *  it cannot comply, and its reason goes to the user (chat refinement), not
 *  back to the agent. (The agent-node standard.) */
const RETRYABLE_OUTPUT_ERRORS: ReadonlySet<AgentOutputErrorCode> = new Set([
  AGENT_OUTPUT_ERROR.NO_JSON,
  AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
]);

export { RETRYABLE_OUTPUT_ERRORS };
