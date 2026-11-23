/**
 * Unit tests for the agent kind's prompt assembly (`agentPrompt.ts`) — the
 * ONE prompt path `run`, `chat` and `previewPrompt` share (§3.11), so the
 * preview cannot drift from the run. The DB-backed paths (template rendering
 * against the flow context, model resolution, prompt_source) stay covered
 * end-to-end in `agentTemplateNode.test.ts`; here the composition contract is
 * pinned directly: which directives are appended, in which order, and the
 * byte-identity guarantees.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

beforeAll(resetTestDatabase);
// dynamic imports execute in statement order after the static ones hoist —
// the test database is assigned by then (agentTemplateNode.test.ts's pattern)
const { composeAgentPrompt, agentContractDirective } = await import("./agentPrompt");
const { AgentDefSchema } = await import("../../schemas/declarativeSchemas");

const SCHEMA = { type: "object", properties: { cost: { type: "integer" } }, required: ["cost"] };

const jsonDef = () => AgentDefSchema.parse({ output: "json", output_schema: SCHEMA });
const markdownDef = () => AgentDefSchema.parse({});
const schemalessJsonDef = () => AgentDefSchema.parse({ output: "json", output_schema: null });

describe("composeAgentPrompt", () => {
  it("a markdown body comes back byte-identical (no compose round-trip)", () => {
    const body = "# Done\n\nThe work is complete.";
    expect(composeAgentPrompt(body, markdownDef(), z.record(z.string(), z.unknown()))).toBe(body);
  });

  it("a json output appends the contract directive carrying the generated schema", () => {
    const outputSchema = z.object({ cost: z.number() });
    const composed = composeAgentPrompt("Estimate the cost", jsonDef(), outputSchema);
    expect(composed.startsWith("Estimate the cost")).toBe(true);
    expect(composed).toContain("RESPONSE FORMAT");
    // the directive carries the schema bytes the validator enforces
    // (z.toJSONSchema of the contract — step 04)
    expect(composed).toContain("It must satisfy this JSON Schema");
    expect(composed).toContain('"type": "number"');
    expect(composed).toContain('"output_error"');
  });

  it("a json output without a declared schema appends the schemaless directive", () => {
    const composed = composeAgentPrompt("Estimate the cost", schemalessJsonDef(), z.record(z.string(), z.unknown()));
    expect(composed).toContain("RESPONSE FORMAT");
    expect(composed).toContain("exactly one JSON object");
    expect(composed).not.toContain("It must satisfy this JSON Schema");
  });

});

describe("agentContractDirective", () => {
  it("is the exact block composeAgentPrompt appends for a json output", () => {
    const outputSchema = z.object({ cost: z.number() });
    const composed = composeAgentPrompt("body", jsonDef(), outputSchema);
    expect(composed).toContain(agentContractDirective(jsonDef(), outputSchema));
  });

  it("an output_format other than json is the caller's gate — the directive itself is shape-agnostic", () => {
    // the directive is a pure formatter; the json gate lives in composeAgentPrompt
    expect(agentContractDirective(markdownDef(), z.record(z.string(), z.unknown()))).toContain("RESPONSE FORMAT");
  });
});
