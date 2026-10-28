/** Public surface of the standard agent output-contract error. Consumers
 *  construct {@link AgentOutputError} directly — no exported factory
 *  functions — and use its statics for the agent-facing contract. */
export {
  AGENT_ERROR_ENVELOPE_EXAMPLE,
  AGENT_ERROR_ENVELOPE_KEY,
  AGENT_OUTPUT_ERROR,
  RESPONSE_EXCERPT_LENGTH,
  type AgentOutputErrorCode,
} from "./constants";
export {
  AgentErrorEnvelopeSchema,
  AgentOutputErrorDetailSchema,
  AgentOutputIssueSchema,
  AgentReportedErrorSchema,
} from "./schema";
export type {
  AgentOutputErrorDetail,
  AgentOutputErrorInput,
  AgentOutputIssue,
  AgentReportedError,
} from "./types";
export { AgentOutputError } from "./agent-output-error";
