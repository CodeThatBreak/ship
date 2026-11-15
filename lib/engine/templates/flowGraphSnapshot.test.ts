import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { hydrateFlowTemplateGraph, serializeFlowTemplateGraph } from "./flowGraphSnapshot";
import type { TemplateGraph } from "../types/template";

assignTestDatabase();

const { importTemplateYaml } = await import("./templateYaml");
const { templateStore } = await import("./templateStore");
const { flowEngine } = await import("../flowEngine");
const { db } = await import("../../db/app");

const miniYaml = `
name: Snapshot test
trigger:
  type: manual
nodes:
  - key: plan
    type: builtin/plan
  - key: build
    type: builtin/build
edges:
  - [plan, build]
`;

describe("flow template graph snapshot (CR-065)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("graphForFlow keeps edges from creation after the live template changes", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, miniYaml, { namePrefix: "snap" });
    const before = await templateStore.graph(templateId);
    expect(before?.edges).toEqual([{ from: "plan", to: "build", kind: "next", label: null, condition: null }]);

    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_snap", "jira", "SNAP-1", "snap test", "open", "task", "P2",
    );
    const flowId = await flowEngine.create("task_snap", "https://example.com/repo.git", "snap flow", {
      templateId,
      autoStart: false,
    });

    await db.run(`DELETE FROM flow_template_edges WHERE template_id=$1`, templateId);

    const live = await templateStore.graph(templateId);
    expect(live?.edges).toEqual([]);
    const frozen = await templateStore.graphForFlow(flowId);
    expect(frozen?.edges).toEqual(before?.edges);
  });

  it("round-trips serialize/hydrate with byKey", async () => {
    const graph: TemplateGraph = {
      templateId: "tpl_x",
      version: 1,
      flowTrigger: { type: "manual" },
      nodes: [
        {
          key: "a",
          defKey: "plan",
          nodeTemplateId: "nt_plan",
          catalogKind: "plan",
          label: "Plan",
          joinMode: "all",
          config: {},
          trigger: { type: "manual" },
          inputMap: {},
        },
      ],
      edges: [],
      byKey: new Map(),
    };
    const node = graph.nodes[0];
    if (!node) throw new Error("expected node");
    graph.byKey.set("a", node);
    const hydrated = hydrateFlowTemplateGraph(serializeFlowTemplateGraph(graph));
    expect(hydrated?.templateId).toBe("tpl_x");
    expect(hydrated?.byKey.get("a")?.catalogKind).toBe("plan");
  });
});
