import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../../tests/helpers/inMemoryDb";

assignDatabasePath(createIsolatedDatabasePath("devflow-graph-save-"));

const { importTemplateYaml } = await import("./templateYaml");
const { templateStore } = await import("./templateStore");

describe("TemplateStore graph structure on save", () => {
  it("rejects a next-edge cycle at save time (CR-062)", () => {
    const yaml = `
name: Cycle save test
trigger:
  type: manual
nodes:
  - key: a
    type: agent
    config:
      prompt: hi
  - key: b
    type: agent
    config:
      prompt: hi
edges:
  - [a, b]
  - [b, a]
`;
    expect(() => importTemplateYaml(templateStore, yaml, { namePrefix: "cycle" })).toThrow(
      /loop edge/,
    );
  });
});
