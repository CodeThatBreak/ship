import "server-only";

import { AGENT_OUTPUT_ERROR, type AgentOutputErrorCode } from '../../agent/outputError/outputErrorExports';

/** The ONE shared retryability set (step 05 dedupe — the plan/resolve/agent
 *  private copies are gone): output-contract failures a feedback turn can fix
 *  are missing or schema-violating JSON. `agent_reported` never retries — the
 *  agent explicitly said it cannot comply, and its reason goes to the user
 *  (chat refinement), not back to the agent. */
export const RETRYABLE_OUTPUT_ERRORS: ReadonlySet<AgentOutputErrorCode> = new Set([
  AGENT_OUTPUT_ERROR.NO_JSON,
  AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
]);
