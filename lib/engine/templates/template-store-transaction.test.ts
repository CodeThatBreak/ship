import { describe, expect, it, vi } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../../tests/helpers/in-memory-db";
import { ValidationError } from "../../errors";

assignDatabasePath(createIsolatedDatabasePath("devflow-tpl-txn-"));

const { importTemplateYaml } = await import("./template-yaml");
const { templateStore } = await import("./template-store");
const { db } = await import("../../db");

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
  it("saveWithDrafts leaves no draft rows when update fails (CR-050)", () => {
    const { id } = importTemplateYaml(templateStore, miniYaml, { namePrefix: "save-drafts" });
    const before = db.all<{ id: string }>(
      `SELECT id FROM node_templates WHERE template_id=?`,
      id,
    ).length;

    const spy = vi.spyOn(templateStore, "update").mockImplementation(() => {
      throw new ValidationError("simulated save failure");
    });
    try {
      expect(() =>
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
      ).toThrow("simulated save failure");
    } finally {
      spy.mockRestore();
    }

    const after = db.all<{ id: string }>(
      `SELECT id FROM node_templates WHERE template_id=?`,
      id,
    ).length;
    expect(after).toBe(before);
  });

  it("failed YAML import does not delete a reused pre-existing node template (CR-067)", () => {
    const agentConfig = { prompt: "reuse me", model: "test" };
    const existing = templateStore.ensureNodeTemplate({
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

    expect(() => importTemplateYaml(templateStore, badYaml, { namePrefix: "cr067" })).toThrow();
    expect(templateStore.nodeTemplate(existing.id)?.id).toBe(existing.id);
    expect(
      db.get<{ c: number }>(`SELECT COUNT(*) c FROM flow_templates WHERE name LIKE ?`, "cr067 — Broken import%")?.c,
    ).toBe(0);
  });
});
