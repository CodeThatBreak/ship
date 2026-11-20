import "server-only";

import type { AgentOutputError } from "../agentOutputError";

/** The FIRST violation in plain words — the same headline a schema_mismatch
 *  run event shows (the empty case is genuinely possible: `agent_reported`). */
export const firstViolation = (failure: AgentOutputError): string => {
  const issue = failure.detail.issues[0];
  if (issue == null || issue.message === '') return failure.detail.message;
  return issue.message;
};
