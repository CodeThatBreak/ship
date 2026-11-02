import { describe, expect, it } from "vitest";
import { jsonataTruthy } from "./eval";

describe("jsonataTruthy", () => {
  it("matches JSONata $boolean for scalars", () => {
    expect(jsonataTruthy(true)).toBe(true);
    expect(jsonataTruthy("x")).toBe(true);
    expect(jsonataTruthy(false)).toBe(false);
    expect(jsonataTruthy(null)).toBe(false);
    expect(jsonataTruthy(undefined)).toBe(false);
    expect(jsonataTruthy("")).toBe(false);
    expect(jsonataTruthy(0)).toBe(false);
    expect(jsonataTruthy(Number.NaN)).toBe(false);
  });

  it("treats empty arrays and objects as falsy", () => {
    expect(jsonataTruthy([])).toBe(false);
    expect(jsonataTruthy({})).toBe(false);
  });

  it("treats all-falsy arrays as falsy and any truthy element as truthy", () => {
    expect(jsonataTruthy([0, "", false])).toBe(false);
    expect(jsonataTruthy([0, "hit"])).toBe(true);
  });
});
