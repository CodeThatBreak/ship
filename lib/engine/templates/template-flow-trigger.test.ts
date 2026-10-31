import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../../tests/helpers/in-memory-db";

assignDatabasePath(createIsolatedDatabasePath("devflow-flow-trigger-"));

const { importTemplateYaml } = await import("./template-yaml");
const { templateStore } = await import("./template-store");

const miniYaml = `
name: Flow trigger test
trigger:
  type: manual
nodes:
  - key: plan
    type: builtin/plan
edges: []
`;

describe("TemplateStore flow trigger", () => {
  it("imports templates with manual trigger", () => {
    const { id } = importTemplateYaml(templateStore, miniYaml, { namePrefix: "trigger-test" });
    expect(id).toMatch(/^tpl_/);
    const graph = templateStore.graph(id);
    expect(graph?.flowTrigger.type).toBe("manual");
  });

  it("rejects legacy webhook flow trigger types on import", () => {
    const yaml = miniYaml.replace("type: manual", "type: webhook");
    expect(() => importTemplateYaml(templateStore, yaml, { namePrefix: "trigger-test" })).toThrow(
      /unknown flow trigger type "webhook"/,
    );
  });
});
