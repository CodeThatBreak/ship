import { describe, expect, it } from "vitest";
import { extractJson } from "./extractJson";

describe("extractJson", () => {
  it("parses a fenced JSON block", () => {
    expect(extractJson('text\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
