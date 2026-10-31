import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../../tests/helpers/in-memory-db";
import { hydrateFlowTemplateGraph, serializeFlowTemplateGraph } from "./flow-graph-snapshot";
import type { TemplateGraph } from "../types/template";

assignDatabasePath(createIsolatedDatabasePath("devflow-flow-graph-snap-"));

const { importTemplateYaml } = await import("./template-yaml");
const { templateStore } = await import("./template-store");
const { flowEngine } = await import("../flow-engine");
const { db } = await import("../../db");

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
  it("graphForFlow keeps edges from creation after the live template changes", () => {
    const { id: templateId } = importTemplateYaml(templateStore, miniYaml, { namePrefix: "snap" });
    const before = templateStore.graph(templateId);
    expect(before?.edges).toEqual([{ from: "plan", to: "build", kind: "next", label: null, condition: null }]);

    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      "task_snap", "jira", "SNAP-1", "snap test", "open", "task", "P2",
    );
    const flowId = flowEngine.create("task_snap", "https://example.com/repo.git", "snap flow", {
      templateId,
      autoStart: false,
    });

    db.run(`DELETE FROM flow_template_edges WHERE template_id=?`, templateId);

    const live = templateStore.graph(templateId);
    expect(live?.edges).toEqual([]);
    const frozen = templateStore.graphForFlow(flowId);
    expect(frozen?.edges).toEqual(before?.edges);
  });

  it("round-trips serialize/hydrate with byKey", () => {
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
