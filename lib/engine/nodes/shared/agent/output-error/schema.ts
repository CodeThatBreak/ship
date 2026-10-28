import { z } from "zod";
import { AGENT_ERROR_ENVELOPE_KEY, AGENT_OUTPUT_ERROR, type AgentOutputErrorCode } from "./constants";

/** One output-contract violation: the dotted path under the agent's JSON
 *  response ("" = the root) and the human message for what failed there. */
export const AgentOutputIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/**
 * What the agent reports when it cannot satisfy its output contract (the
 * missing input, the ambiguity, the impossibility). Moved through the
 * envelope; the engine carries it verbatim — the agent's vocabulary, not ours.
 */
export const AgentReportedErrorSchema = z.looseObject({
  /** why the response cannot satisfy the output contract */
  reason: z.string().min(1),
  /** the agent's own short tag (free-form — we don't constrain it) */
  code: z.string().min(1).optional(),
});

/** The standard structured payload every output-contract failure carries. */
export const AgentOutputErrorDetailSchema = z.object({
  code: z.enum(Object.values(AGENT_OUTPUT_ERROR) as [AgentOutputErrorCode, ...AgentOutputErrorCode[]]),
  label: z.string(),
  message: z.string(),
  issues: z.array(AgentOutputIssueSchema),
  /** when code = agent_reported: the agent's own self-report, carried verbatim */
  reported: AgentReportedErrorSchema.optional(),
  /** head of the agent's raw response (trimmed, `RESPONSE_EXCERPT_LENGTH` chars) */
  response_excerpt: z.string(),
});

/** The envelope an agent answers with instead of contract-conforming output. */
export const AgentErrorEnvelopeSchema = z.looseObject({
  [AGENT_ERROR_ENVELOPE_KEY]: AgentReportedErrorSchema,
});
