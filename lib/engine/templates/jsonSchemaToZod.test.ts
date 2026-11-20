import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "./jsonSchemaToZod";

const LABEL = "Test Node";

/** A representative template-authored output_schema (the agent-node shape). */
const schema = {
  type: "object",
  required: ["severity"],
  properties: {
    severity: { type: "string", enum: ["low", "med", "high"] },
    count: { type: "integer", minimum: 1 },
    summary: { type: "string" },
  },
};

describe("jsonSchemaToZod — the JSON-Schema → Zod contract boundary", () => {
  it("a valid payload passes the converted contract", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    expect(contract.safeParse({ severity: "high", count: 2, summary: "ok" }).success).toBe(true);
  });

  it("a missing required field fails", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    expect(contract.safeParse({ summary: "no severity" }).success).toBe(false);
  });

  it("an enum violation fails", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    expect(contract.safeParse({ severity: "catastrophic" }).success).toBe(false);
  });

  it("a non-integer number fails the integer field", () => {
    const contract = jsonSchemaToZod(schema, LABEL);
    expect(contract.safeParse({ severity: "low", count: 1.5 }).success).toBe(false);
  });

  it("a malformed schema is a loud authoring error, not a silent pass", () => {
    expect(() => jsonSchemaToZod(null, LABEL)).toThrow(`${LABEL}: invalid output schema`);
    expect(() => jsonSchemaToZod("type: object", LABEL)).toThrow(`${LABEL}: invalid output schema`);
    expect(() => jsonSchemaToZod([schema], LABEL)).toThrow(`${LABEL}: invalid output schema`);
  });
});
