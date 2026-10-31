import { describe, expect, it } from "vitest";
import { lintNodeTrigger, lintTemplate } from "./templateLint";

describe("template-lint — node triggers", () => {
  it("flags unknown wait_for sources", () => {
    const problems: Parameters<typeof lintNodeTrigger>[2] = [];
    lintNodeTrigger('node "pipeline"', { type: "auto", wait_for: "gitlab_pipeline" }, problems, "pipeline");
    expect(problems.some((p) => /unknown wait_for/.test(p.message))).toBe(true);
  });

  it("flags unknown trigger types", () => {
    const lint = lintTemplate(
      [{
        key: "plan",
        nodeTemplateId: "nt_plan",
        inputMap: {},
        config: {},
        trigger: { type: "webhook" },
      }],
      [],
      { nt_plan: { kind: "builtin", config: {}, key: "plan", isBuiltin: true } },
    );
    expect(lint.error).toMatch(/unknown node trigger type/);
  });
});
