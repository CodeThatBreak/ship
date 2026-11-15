import { beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { ValidationError } from "../../errors";

assignTestDatabase();

const { importTemplateYaml } = await import("./templateYaml");
const { templateStore } = await import("./templateStore");
const { db } = await import("../../db/app");

const miniYaml = `
name: Draft save test
trigger:
  type: manual
nodes:
  - key: plan
    type: builtin/plan
edges: []
`;

describe("TemplateStore transactions", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("saveWithDrafts leaves no draft rows when update fails (CR-050)", async () => {
    const { id } = await importTemplateYaml(templateStore, miniYaml, { namePrefix: "save-drafts" });
    const before = (await db.all<{ id: string }>(
      `SELECT id FROM node_templates WHERE template_id=$1`,
      id,
    )).length;

    const spy = vi.spyOn(templateStore, "update").mockImplementation(() => {
      throw new ValidationError("simulated save failure");
    });
    try {
      await expect(() =>
        templateStore.saveWithDrafts(id, {
          nodes: [
            {
              key: "agent1",
              nodeTemplateId: "draft:1",
              trigger: { type: "auto" },
            },
          ],
          edges: [],
          new_node_templates: [
            {
              draft_id: "draft:1",
              name: "Inline agent",
              kind: "agent",
              config: { prompt: "hello" },
            },
          ],
        }),
      ).rejects.toThrow("simulated save failure");
    } finally {
      spy.mockRestore();
    }

    const after = (await db.all<{ id: string }>(
      `SELECT id FROM node_templates WHERE template_id=$1`,
      id,
    )).length;
    expect(after).toBe(before);
  });

  it("failed YAML import does not delete a reused pre-existing node template (CR-067)", async () => {
    const agentConfig = { prompt: "reuse me", model: "test" };
    const existing = await templateStore.ensureNodeTemplate({
      key: "reuse_agent",
      name: "Reuse agent",
      kind: "agent",
      config: agentConfig,
    });
    expect(existing.created).toBe(true);

    const badYaml = `
name: Broken import
trigger:
  type: manual
nodes:
  - key: reuse_agent
    type: agent
    config:
      prompt: reuse me
      model: test
  - key: orphan
    type: agent
    config:
      prompt: x
edges:
  - [reuse_agent, missing_target]
`;

    await expect(() => importTemplateYaml(templateStore, badYaml, { namePrefix: "cr067" })).rejects.toThrow();
    expect((await templateStore.nodeTemplate(existing.id))?.id).toBe(existing.id);
    expect(
      (await db.get<{ c: number }>(`SELECT COUNT(*)::int c FROM flow_templates WHERE name LIKE $1`, "cr067 — Broken import%"))?.c,
    ).toBe(0);
  });
});
