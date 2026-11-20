import "server-only";

import { z } from "zod";
import { extractJson } from "../../extractJson";
import {
  AGENT_OUTPUT_ERROR,
  AgentOutputError,
  type AgentOutputIssue,
} from "../../agent/outputError/outputErrorExports";

/** The knobs that make one standard validation a kind's own contract: the
 *  label (messages), the schema, the two message tails, and the optional
 *  object/semantic gates. The CONTROL FLOW is shared and unvarying —
 *  `extractJson` → object gate → error envelope → schema → semantics. */
export interface StandardOutputValidation<R> {
  readonly label: string;
  readonly text: string;
  readonly schema: z.ZodType<R>;
  /** the clause after "contained no JSON — " in the `no_json` message */
  readonly noJsonNote: string;
  /** the fallback headline when a `schema_mismatch` carries no issue */
  readonly mismatchNote: string;
  /** reject non-object JSON before the envelope/schema checks (agent-json) */
  readonly mustBeObject?: boolean;
  /** post-shape semantic checks (resolve's per-comment decision coverage) */
  readonly semantic?: (value: R) => readonly AgentOutputIssue[];
}

/**
 * The standard agent-output validation every JSON-contract kind shares
 * (step 05 — the three private `extractJson → envelope → schema` copies are
 * gone): throws the standard {@link AgentOutputError} — `no_json`, the
 * agent's error envelope (`agent_reported`), or `schema_mismatch` carrying
 * every issue — and returns the parsed value on success.
 */
export const validateStandardAgentOutput = <R>(v: StandardOutputValidation<R>): R => {
  const parsed = extractJson(v.text ?? "");
  if (parsed == null) {
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.NO_JSON,
      label: v.label,
      message: `${v.label}: the agent response contained no JSON — ${v.noJsonNote}`,
      issues: [],
      response: v.text,
    });
  }
  if (v.mustBeObject && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label: v.label,
      message: `${v.label}: json output must be a JSON object (got ${Array.isArray(parsed) ? "array" : typeof parsed})`,
      issues: [],
      response: v.text,
    });
  }
  // the agent's escape hatch: it answered with the standard error envelope
  // instead of contract-conforming output — convey its reason
  const reported = AgentOutputError.reported(parsed);
  if (reported != null) {
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
      label: v.label,
      // the agent's reason is the headline — its words, conveyed to the user
      message: `${v.label}: ${reported.reason}`,
      issues: [],
      reported,
      response: v.text,
    });
  }
  const result = v.schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label: v.label,
      // the first violation stays the headline — every issue in the payload
      message: issues[0]?.message ?? v.mismatchNote,
      issues,
      response: v.text,
    });
  }
  const semantic = v.semantic?.(result.data) ?? [];
  if (semantic.length) {
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label: v.label,
      message: semantic[0]?.message ?? v.mismatchNote,
      issues: [...semantic],
      response: v.text,
    });
  }
  return result.data;
};
