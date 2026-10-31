import { describe, expect, it } from "vitest";
import { DecisionDefSchema } from "../../declarativeSchemas";

describe("DecisionDefSchema", () => {
  it("does not retain the legacy single global expression field", () => {
    const parsed = DecisionDefSchema.parse({
      source: "expression",
      expression: "true",
      choices: [{ label: "a", condition: "true" }],
    });
    expect("expression" in parsed).toBe(false);
  });
});
