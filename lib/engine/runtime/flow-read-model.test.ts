/**
 * FlowReadModel batching (CR-185): child flows/nodes load in one query each;
 * artifact rows omit bodies for lazy fetch via GET /api/artifacts/:id.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-read-model-")),
  "test.db",
);

const { db } = await import("../../db");
const { FlowReadModel } = await import("./flow-read-model");
const { WaitScheduler } = await import("./wait-scheduler");

const now = () => new Date().toISOString();

describe("FlowReadModel.get", () => {
  it("batches step-child flows and returns artifact metadata without content bodies", () => {
    const taskId = "task_rm";
    const parentId = "flw_parent";
    const childId = "flw_child";
    const nodeId = "node_1";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "generic", "RM-1", "read model", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      parentId, taskId, "parent", "active", now(), now(),
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      childId, taskId, "child", "active", parentId, "step", JSON.stringify({ parentNodeKey: "build" }), now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      nodeId, parentId, "plan", "plan", "done", now(), now(),
    );
    db.run(
      `INSERT INTO plan_steps (id, flow_id, title, position, status, sub_flow_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      "step_1", parentId, "Step A", 0, "pending", childId, now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_child", childId, "work", "build", "running", now(), now(),
    );
    db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      "art_1", nodeId, parentId, "plan", 1, "# Large plan body", "draft", now(),
    );

    const host = {
      nodeStatus: () => "",
      setNodeStatus: () => {},
      claimNode: () => "attempt",
      bg: () => {},
      nodeConfigFor: () => ({}),
      chainBusy: () => false,
      startNodeStage: async () => {},
    };
    const waits = new WaitScheduler(host);
    const readModel = new FlowReadModel(waits);

    const allSpy = vi.spyOn(db, "all");

    const snapshot = readModel.get(parentId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.planSteps?.[0] && "sub_flow" in snapshot.planSteps[0] && snapshot.planSteps[0].sub_flow?.id).toBe(childId);
    expect(snapshot?.planSteps?.[0] && "sub_flow" in snapshot.planSteps[0] && snapshot.planSteps[0].sub_flow?.nodeStatus).toBeTruthy();

    const planNode = snapshot?.nodes.find((n) => n.node_key === "plan");
    expect(planNode?.artifacts[0]?.id).toBe("art_1");
    expect(planNode?.artifacts[0]?.content).toBe("");

    const batchedChildFlow = allSpy.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("FROM flows WHERE id IN"),
    );
    const batchedChildNodes = allSpy.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("FROM nodes WHERE flow_id IN"),
    );
    const batchedArtifacts = allSpy.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("FROM artifacts WHERE node_id IN"),
    );
    expect(batchedChildFlow).toBe(true);
    expect(batchedChildNodes).toBe(true);
    expect(batchedArtifacts).toBe(true);

    allSpy.mockRestore();
  });
});
