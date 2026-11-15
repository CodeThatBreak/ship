import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { importTemplateYaml } = await import("./templateYaml");
const { templateStore } = await import("./templateStore");

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
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("imports templates with manual trigger", async () => {
    const { id } = await importTemplateYaml(templateStore, miniYaml, { namePrefix: "trigger-test" });
    expect(id).toMatch(/^tpl_/);
    const graph = await templateStore.graph(id);
    expect(graph?.flowTrigger.type).toBe("manual");
  });

  it("rejects legacy webhook flow trigger types on import", async () => {
    const yaml = miniYaml.replace("type: manual", "type: webhook");
    await expect(() => importTemplateYaml(templateStore, yaml, { namePrefix: "trigger-test" })).rejects.toThrow(
      /unknown flow trigger type "webhook"/,
    );
  });
});
