import { describe, expect, it } from "vitest";

const { nodeRegistry } = await import("./registry");
const { AgentTemplateNode } = await import("./kinds/agent/agent-node");
const { DecisionTemplateNode } = await import("./kinds/decision/decision-node");
const { parseDeclarativeConfig, DecisionDefSchema } = await import("./declarative-schemas");
import type { DecisionDef } from "./declarative-schemas";

describe("parseRunConfig — built-in nodes", () => {
  it("rejects poll_interval_sec below the schema minimum", () => {
    const pipeline = nodeRegistry.resolve("pipeline");
    expect(() =>
      pipeline.parseRunConfig({
        ...pipeline.defaultConfig(),
        poll_interval_sec: 0,
      }),
    ).toThrow(/poll_interval_sec/);
  });
});

describe("declarative run config", () => {
  it("fails loudly when one instance field is invalid (no catalog fallback)", () => {
    const base = { prompt: "hi", output: "markdown" as const };
    const agent = new AgentTemplateNode(
      { id: "nt_cfg", name: "Agent", description: null, config: base },
      "agent_cfg",
    );
    expect(() => agent.parseRunConfig({ ...base, output: "not-a-format" })).toThrow(/invalid config/);
  });

  it("validates manual picks against instance choices, not the catalog row", () => {
    const catalog = {
      source: "manual" as const,
      choices: [{ label: "catalog-a" }, { label: "catalog-b" }],
    };
    const node = new DecisionTemplateNode(
      { id: "nt_dec", name: "Decide", description: null, config: catalog },
      "decide_1",
    );
    const instance = {
      ...catalog,
      choices: [{ label: "instance-x" }, { label: "instance-y" }],
    };
    const cfg = DecisionDefSchema.parse(instance) as DecisionDef;
    expect(() => node.validateChoice(["catalog-a"], cfg)).toThrow(/not one of this decision's choices/);
    expect(() => node.validateChoice(["instance-x"], cfg)).not.toThrow();
  });

  it("parseDeclarativeConfig surfaces the first invalid field", () => {
    expect(() => parseDeclarativeConfig("http", { timeout_ms: -1 }, "Call")).toThrow(/timeout_ms/);
  });
});
