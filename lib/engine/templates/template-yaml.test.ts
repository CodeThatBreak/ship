import { describe, expect, it } from "vitest";
import { exportTemplateYaml, parseTemplateYaml, YamlTemplateError } from "./template-yaml";

describe("parseTemplateYaml", () => {
  it("parses nodes and edges from the SDLC fixture shape", () => {
    const parsed = parseTemplateYaml(`
name: Mini
trigger:
  type: manual
nodes:
  - key: plan
    type: builtin/plan
edges:
  - [plan, build]
  - [build, pipeline, {"kind": "loop", "condition": "true"}]
`);
    expect(parsed.name).toBe("Mini");
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.key).toBe("plan");
    expect(parsed.edges).toEqual([
      { from: "plan", to: "build", kind: undefined, label: undefined, condition: undefined },
      { from: "build", to: "pipeline", kind: "loop", label: undefined, condition: "true" },
    ]);
  });

  it("throws readable errors for invalid YAML", () => {
    expect(() => parseTemplateYaml("name: [")).toThrow(YamlTemplateError);
    expect(() => parseTemplateYaml("name: x\nnodes: []")).toThrow(/at least one node/);
  });

  it("quotes edge endpoints so YAML boolean/null keys round-trip (CR-191)", () => {
    const yaml = exportTemplateYaml({
      name: "Bool keys",
      description: null,
      trigger: { type: "manual" },
      nodes: [
        {
          key: "true",
          nodeTemplateId: "nt_a",
          label: "True node",
          trigger: {},
          joinMode: "all",
          config: {},
          inputMap: {},
        },
        {
          key: "null",
          nodeTemplateId: "nt_b",
          label: "Null node",
          trigger: {},
          joinMode: "all",
          config: {},
          inputMap: {},
        },
      ],
      edges: [{ from: "true", to: "null", kind: "next", label: null, condition: null }],
      catalog: {
        nt_a: { key: "agent_a", name: "A", kind: "agent", isBuiltin: false, config: { prompt: "x" } },
        nt_b: { key: "agent_b", name: "B", kind: "agent", isBuiltin: false, config: { prompt: "y" } },
      },
    });
    expect(yaml).toContain(`- ["true", "null"]`);
    const parsed = parseTemplateYaml(yaml);
    expect(parsed.edges[0]).toMatchObject({ from: "true", to: "null" });
  });
});
