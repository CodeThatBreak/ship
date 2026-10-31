/**
 * NodeSupport artifact queries — ordering must match "newest first" so
 * `latestArtifact` and plan/build consumers see the approved version.
 *
 * Isolated temp SQLite DB (AGENTS.md §1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-support-")),
  "test.db",
);

const { db } = await import("../../../db");
const { NodeSupport } = await import("./node-support");

const now = () => new Date().toISOString();

const seedPlanNode = (flowId: string) => {
  const taskId = `task_${flowId}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId,
    "generic",
    `TST-${flowId}`,
    "node-support test",
    "open",
    "task",
    "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId,
    taskId,
    "node-support test",
    "active",
    now(),
    now(),
  );
  const nodeId = `node_${flowId}`;
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    nodeId,
    flowId,
    "plan",
    "plan",
    "awaiting_approval",
    now(),
    now(),
  );
  return nodeId;
};

describe("NodeSupport — plan artifact ordering (CR-270)", () => {
  const support = new NodeSupport();

  it("latestArtifact and artifactsOfKind return newest plan versions first", () => {
    const flowId = "flw_art_order";
    const nodeId = seedPlanNode(flowId);

    support.saveArtifact(nodeId, flowId, "plan", "# Plan v1", { steps: [], branches: [] });
    support.saveArtifact(nodeId, flowId, "plan", "# Plan v2", { steps: [], branches: [] });
    support.saveArtifact(nodeId, flowId, "plan", "# Plan v3", { steps: [], branches: [] });

    const latest = support.latestArtifact(flowId, "plan", { nodeType: "plan" });
    expect(latest?.version).toBe(3);
    expect(latest?.content).toBe("# Plan v3");

    const all = support.artifactsOfKind(flowId, "plan", { nodeType: "plan" });
    expect(all.map((a) => a.version)).toEqual([3, 2, 1]);
  });
});
