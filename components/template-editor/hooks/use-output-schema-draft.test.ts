import { describe, expect, it } from "vitest";
import { parseOutputSchemaText } from "./use-output-schema-draft";

describe("parseOutputSchemaText", () => {
  it("does not emit on empty input", () => {
    expect(parseOutputSchemaText("   ")).toEqual({
      schema: undefined,
      saved: undefined,
    });
  });

  it("parses TS-lite members", () => {
    const result = parseOutputSchemaText("summary: string;");
    expect(result.err).toBeUndefined();
    expect(result.schema).toMatchObject({ type: "object" });
  });

  it("surfaces errors for invalid text", () => {
    const result = parseOutputSchemaText("not valid");
    expect(result.err).toBeTruthy();
  });
});
