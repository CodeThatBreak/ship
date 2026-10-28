/**
 * The standard error for agent output-contract failures: a node whose declared
 * output format (e.g. `output: json` + an output schema) is not satisfied by
 * the agent's response fails loudly with this one payload shape.
 *
 * `message` is the human text the flow feed already renders; `detail` is the
 * validated structured payload (error code, the per-path schema violations,
 * and the head of the raw response so a developer can see what actually came
 * back). The class is what nodes throw so engine catch sites can branch on it
 * and forward `detail` (e.g. as error-event data) without parsing `message`.
 *
 * There are no factory functions: consumers construct the error directly with
 * `new AgentOutputError({ code, label, message, issues, response, reported? })`.
 */
import {
  AGENT_ERROR_ENVELOPE_EXAMPLE,
  AGENT_ERROR_ENVELOPE_KEY,
  RESPONSE_EXCERPT_LENGTH,
  type AgentOutputErrorCode,
} from "./constants";
import { AgentErrorEnvelopeSchema, AgentOutputErrorDetailSchema } from "./schema";
import type { AgentOutputErrorDetail, AgentOutputErrorInput, AgentReportedError } from "./types";

/** The head of a raw response: full text when short, the first slice + ellipsis.
 *  Module-private — the constructor excerpts `input.response`; callers never
 *  build `response_excerpt` by hand. */
function responseExcerpt(text: string): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= RESPONSE_EXCERPT_LENGTH) return trimmed;
  return `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH)}…`;
}

export class AgentOutputError extends Error {
  readonly code: AgentOutputErrorCode;
  /** The standard detail — schema-validated here, so it is always safe to
   *  serialize into event data / diagnostics as-is. */
  readonly detail: AgentOutputErrorDetail;

  constructor(input: AgentOutputErrorInput) {
    super(input.message);
    this.name = "AgentOutputError";
    this.code = input.code;
    this.detail = AgentOutputErrorDetailSchema.parse({
      code: input.code,
      label: input.label,
      message: input.message,
      issues: input.issues,
      ...(input.reported != null ? { reported: input.reported } : {}),
      response_excerpt: responseExcerpt(input.response),
    });
  }

  // ── the agent-facing half of the standard ─────────────────────────────────
  // Two directions: what we tell the agent (the prompt directive carrying the
  // schema and the error envelope), and what we accept back from it (the
  // envelope it answers with when it cannot comply).

  /**
   * The response-format directive json-output agent prompts are appended with:
   * the schema the response must satisfy, and the standard error envelope as
   * the agent's escape hatch — so a blocked agent can convey why instead of
   * producing garbage output we would only fail on a second later.
   */
  static directive(outputSchema: unknown): string {
    const schemaBlock = outputSchema == null
      ? ""
      : `\n  2. It must satisfy this JSON Schema:\n${JSON.stringify(outputSchema, null, 2).replace(/^/gm, "     ")}\n`;
    return (
      `RESPONSE FORMAT\n` +
      `  1. Your entire response must be exactly one JSON object — no prose before or after.\n` +
      schemaBlock +
      `  3. If you cannot produce JSON that satisfies the contract — the request is missing input, ambiguous, or impossible — respond instead with this error envelope, exactly:\n` +
      `     ${AGENT_ERROR_ENVELOPE_EXAMPLE}\n`
    );
  }

  /** Recognize the standard error envelope in a parsed agent response — the
   *  agent's self-report, or null when the response is a real output. */
  static reported(parsed: unknown): AgentReportedError | null {
    const r = AgentErrorEnvelopeSchema.safeParse(parsed);
    return r.success ? r.data[AGENT_ERROR_ENVELOPE_KEY] : null;
  }
}
