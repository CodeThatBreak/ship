/** The closed set of output-contract failure codes (§2.7). `agent_reported` is
 *  the agent's own escape hatch: it answered with the standard error envelope
 *  (§AgentErrorEnvelopeSchema) instead of contract-conforming output. */
export const AGENT_OUTPUT_ERROR = {
  /** the response contained no JSON at all */
  NO_JSON: "no_json",
  /** the response was JSON but violated the declared output schema */
  SCHEMA_MISMATCH: "schema_mismatch",
  /** the agent self-reported that it cannot satisfy the contract */
  AGENT_REPORTED: "agent_reported",
} as const;

export type AgentOutputErrorCode = (typeof AGENT_OUTPUT_ERROR)[keyof typeof AGENT_OUTPUT_ERROR];

/** The top-level key of the agent's self-report envelope. */
export const AGENT_ERROR_ENVELOPE_KEY = "output_error";

/** How much of the raw response a failure carries — enough to see the shape of
 *  what the agent returned, not enough to bloat the persisted payload. */
export const RESPONSE_EXCERPT_LENGTH = 400;

/** The standard error envelope, as the agent-facing prompt spells it. */
export const AGENT_ERROR_ENVELOPE_EXAMPLE = `{"${AGENT_ERROR_ENVELOPE_KEY}": {"code": "<short-tag>", "reason": "<why you cannot comply — one or two sentences>"}}`;
