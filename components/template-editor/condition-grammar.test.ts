import { describe, expect, it } from "vitest";
import {
  compileCondition,
  decomposeCondition,
  literal,
  parseJsonataLiteral,
  splitTop,
  type ConditionRow,
} from "./condition-grammar";

const row = (
  partial: Partial<ConditionRow> & Pick<ConditionRow, "path">,
): ConditionRow => ({
  op: "eq",
  value: "",
  valueKind: "string",
  ...partial,
});

describe("parseJsonataLiteral", () => {
  it("parses quoted strings, numbers, booleans, and null", () => {
    expect(parseJsonataLiteral('"hello"')).toEqual({
      value: "hello",
      valueKind: "string",
    });
    expect(parseJsonataLiteral("123")).toEqual({
      value: "123",
      valueKind: "number",
    });
    expect(parseJsonataLiteral("true")).toEqual({
      value: "true",
      valueKind: "boolean",
    });
    expect(parseJsonataLiteral("null")).toEqual({
      value: "null",
      valueKind: "null",
    });
  });

  it("rejects bare paths and identifiers", () => {
    expect(parseJsonataLiteral("nodes.b.output.y")).toBeNull();
  });
});

describe("literal", () => {
  it("preserves string quoting for numeric-looking text", () => {
    expect(literal("123", "string")).toBe('"123"');
    expect(literal("123", "number")).toBe("123");
    expect(literal("true", "string")).toBe('"true"');
    expect(literal("true", "boolean")).toBe("true");
  });
});

describe("splitTop", () => {
  it("does not split on and inside escaped quotes", () => {
    const parts = splitTop(String.raw`"a\" and b" and x = 1`, "and");
    expect(parts?.length).toBe(2);
    expect(parts?.[0]?.trim()).toBe(String.raw`"a\" and b"`);
  });
});

describe("condition round-trip", () => {
  it("round-trips quoted string comparisons", () => {
    const rows = [row({ path: "status", value: "123", valueKind: "string" })];
    const expr = compileCondition(rows, "and");
    expect(expr).toBe('status = "123"');
    expect(decomposeCondition(expr)).toEqual({
      rows: [{ path: "status", op: "eq", value: "123", valueKind: "string" }],
      combinator: "and",
    });
  });

  it("uses raw mode when the rhs is a path", () => {
    const expr = "status = nodes.b.output.y";
    expect(decomposeCondition(expr)).toBeNull();
  });

  it("round-trips numeric and boolean rhs", () => {
    const num = compileCondition(
      [row({ path: "count", value: "3", valueKind: "number" })],
      "and",
    );
    expect(decomposeCondition(num)).toEqual({
      rows: [{ path: "count", op: "eq", value: "3", valueKind: "number" }],
      combinator: "and",
    });
  });
});
