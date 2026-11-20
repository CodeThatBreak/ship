/**
 * The standard agent output-contract error (§ shared/agent/output-error):
 * every failure carries the validated `{code, label, message, issues,
 * response_excerpt}` payload so the trail can show what the agent actually
 * returned, and the lite JSON Schema validator reports every violation, not
 * just the first.
 */
import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "../../../../templates/jsonSchemaToZod";
import {
  AGENT_ERROR_ENVELOPE_EXAMPLE,
  AGENT_OUTPUT_ERROR,
  AgentOutputError,
  AgentOutputErrorDetailSchema,
  RESPONSE_EXCERPT_LENGTH,
} from "./outputErrorExports";

const LABEL = "Test Agent";

/** Build a schema-mismatch error carrying just `response` — the excerpt test
 *  reads back `detail.response_excerpt`. */
function mismatchError(response: string): AgentOutputError {
  return new AgentOutputError({
    code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
    label: LABEL,
    message: `${LABEL}: violated`,
    issues: [],
    response,
  });
}

describe("AgentOutputError — the standard payload", () => {
  it("a no_json failure carries the code and the response head", () => {
    const message = `${LABEL}: the agent response contained no JSON — the node's output format is configured as json`;
    const err = new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.NO_JSON,
      label: LABEL,
      message,
      issues: [],
      response: "  here is my prose answer, no json  ",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentOutputError");
    expect(err.message).toBe(message);
    expect(err.code).toBe(AGENT_OUTPUT_ERROR.NO_JSON);
    expect(err.detail).toEqual({
      code: AGENT_OUTPUT_ERROR.NO_JSON,
      label: LABEL,
      message,
      issues: [],
      response_excerpt: "here is my prose answer, no json",
    });
    // the detail validates against the schema — always safe to serialize
    expect(AgentOutputErrorDetailSchema.parse(err.detail)).toEqual(err.detail);
  });

  it("a schema_mismatch failure carries every violation it was given", () => {
    const issues = [
      { path: "cost", message: `${LABEL} at cost must be of type integer (got string)` },
      { path: "steps.2.summary", message: `${LABEL} at steps.2.summary is missing required property "summary"` },
    ];
    const err = new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label: LABEL,
      // the headline message rides the first issue — the same human message
      // shape the contract validator's first issue produces
      message: issues[0]?.message ?? `${LABEL}: violated`,
      issues,
      response: '{"cost":"free"}',
    });
    expect(err.code).toBe(AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH);
    expect(err.message).toBe(`${LABEL} at cost must be of type integer (got string)`);
    expect(err.detail.issues).toEqual(issues);
    expect(JSON.parse(JSON.stringify(err.detail)).response_excerpt).toBe('{"cost":"free"}');
  });

  it("the response excerpt keeps short responses whole and truncates to the cap", () => {
    expect(mismatchError("short").detail.response_excerpt).toBe("short");
    const long = "x".repeat(RESPONSE_EXCERPT_LENGTH + 5);
    expect(mismatchError(long).detail.response_excerpt).toBe(`${"x".repeat(RESPONSE_EXCERPT_LENGTH)}…`);
  });
});

describe("jsonSchemaToZod — the former lite-validator fixtures convert to the contract validator", () => {
  // the SAME schema objects the old lite validator's tests used — now the agent
  // node's real contract validator (step 04)
  const schema = {
    type: "object",
    properties: {
      cost: { type: "integer" },
      color: { enum: ["red", "blue"] },
      note: { minLength: 3 },
    },
    required: ["cost", "color"],
  };

  it("a valid value passes the converted contract", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    expect(contract.safeParse({ cost: 1, color: "red" }).success).toBe(true);
  });

  it("every fixture violation makes the converted contract fail", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    // missing required properties
    expect(contract.safeParse({ note: "hi" }).success).toBe(false);
    // wrong primitive type (integer)
    expect(contract.safeParse({ cost: "free", color: "red" }).success).toBe(false);
    // enum violation
    expect(contract.safeParse({ cost: 1, color: "green" }).success).toBe(false);
    // minLength violation
    expect(contract.safeParse({ cost: 1, color: "red", note: "hi" }).success).toBe(false);
  });

  it("the converted contract reports the violation path", () => {
    const contract = jsonSchemaToZod(
      { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] },
      LABEL,
    );
    const result = contract.safeParse({ tags: ["ok", 3] });
    if (result.success) throw new Error("expected the array item violation to fail");
    const at = result.error.issues.find((issue) => issue.path.join(".").startsWith("tags"));
    if (at == null) throw new Error(`expected a tags-path issue, got ${JSON.stringify(result.error.issues)}`);
    expect(at.path.join(".")).toContain("tags");
  });

  it("stays loud on an invalid schema — an authoring error, not a response failure", () => {
    expect(() => jsonSchemaToZod(null, LABEL)).toThrow(`${LABEL}: invalid output schema`);
    expect(() => jsonSchemaToZod("type: object", LABEL)).toThrow(`${LABEL}: invalid output schema`);
  });
});

describe("the agent-facing standard — envelope and directive", () => {
  it("AgentOutputError.reported recognizes the envelope and rejects contract-shaped output", () => {
    const reported = { code: "missing_input", reason: "I was not given the invoice totals" };
    expect(AgentOutputError.reported({ output_error: reported, extra: "stray agent keys pass through" })).toEqual(reported);
    expect(AgentOutputError.reported({ reason: "just a reason at the root" })).toBeNull();
    expect(AgentOutputError.reported({ output_error: { code: "" } })).toBeNull(); // "code" alone is not a report
    expect(AgentOutputError.reported({ cost: 42 })).toBeNull();
  });

  it("an agent_reported failure carries the agent's reason verbatim as the headline", () => {
    const err = new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
      label: LABEL,
      // the agent's reason is the headline — its words, conveyed to the user
      message: `${LABEL}: the request conflicts with the schema`,
      issues: [],
      reported: { code: "ambiguous", reason: "the request conflicts with the schema" },
      response: "envelope + trailing prose",
    });
    expect(err.code).toBe(AGENT_OUTPUT_ERROR.AGENT_REPORTED);
    expect(err.message).toBe(`${LABEL}: the request conflicts with the schema`);
    // re-validated against the standard payload schema (issues empty, self-report attached)
    expect(AgentOutputErrorDetailSchema.parse(err.detail)).toMatchObject({
      code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
      issues: [],
      reported: { code: "ambiguous", reason: "the request conflicts with the schema" },
    });
  });

  it("the prompt directive carries the schema and the error envelope", () => {
    const directive = AgentOutputError.directive({ type: "object", required: ["cost"] });
    expect(directive).toContain("exactly one JSON object");
    expect(directive).toContain("JSON Schema");
    expect(directive).toContain('"cost"');
    expect(directive).toContain(AGENT_ERROR_ENVELOPE_EXAMPLE);
  });

  it("a schema-less json output keeps the envelope, drops the schema block", () => {
    const directive = AgentOutputError.directive(null);
    expect(directive).toContain(AGENT_ERROR_ENVELOPE_EXAMPLE);
    expect(directive).not.toContain("JSON Schema");
  });
});
