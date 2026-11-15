import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { importTemplateYaml } = await import("./templateYaml");
const { templateStore } = await import("./templateStore");

describe("TemplateStore graph structure on save", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("rejects a next-edge cycle at save time (CR-062)", async () => {
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
    await expect(() => importTemplateYaml(templateStore, yaml, { namePrefix: "cycle" })).rejects.toThrow(
      /loop edge/,
    );
  });
});
