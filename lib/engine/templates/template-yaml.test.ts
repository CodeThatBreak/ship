import { describe, expect, it } from "vitest";
import { parseTemplateYaml, YamlTemplateError } from "./template-yaml";

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
});
