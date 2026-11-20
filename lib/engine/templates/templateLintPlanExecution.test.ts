import { describe, expect, it } from "vitest";
import { lintTemplate } from "./templateLint";

describe("template-lint — plan execution knob", () => {
  const planNode = (config: Record<string, unknown>) => [
    {
      key: "plan",
      nodeTemplateId: "nt_plan",
      inputMap: {},
      config,
    },
  ];
  const catalog = { nt_plan: { kind: "builtin", config: {}, key: "plan", isBuiltin: true } };

  it("flags the retired execution_default \"steps\" on a plan node", async () => {
    const lint = await lintTemplate(planNode({ execution_default: "steps" }), [], catalog);
    expect(lint.error).toMatch(/execution_default "steps" is retired/);
    expect(lint.problems[0]?.nodeKey).toBe("plan");
  });

  it("accepts the current whole | follow knob values", async () => {
    for (const execution_default of ["whole", "follow"]) {
      const lint = await lintTemplate(planNode({ execution_default }), [], catalog);
      expect(lint.error).toBeNull();
    }
  });
});
