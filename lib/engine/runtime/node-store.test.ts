import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-store-")),
  "test.db",
);

const { db } = await import("../../db");
const { nodeStore } = await import("../runtime/node-store");
const { NODE_STATUS } = await import("../constants/node-status");
const { isNodeStarted, childFlowHasStarted } = await import("../constants/node-status");
const { ConflictError } = await import("../../errors");

const now = () => new Date().toISOString();

const seedFlow = (flowId: string, taskId: string) => {
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId,
    "generic",
    taskId.toUpperCase(),
    "node store",
    "open",
    "task",
    "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId,
    taskId,
    "t",
    "active",
    now(),
    now(),
  );
};

describe("NodeStore", () => {
  it("idOf and statusOf read node rows", () => {
    const flowId = "flow_ns1";
    const taskId = "task_ns1";
    seedFlow(flowId, taskId);
    const nodeId = "node_ns1";
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      nodeId,
      flowId,
      "plan",
      "plan",
      NODE_STATUS.PENDING,
      now(),
      now(),
    );
    expect(nodeStore.idOf(flowId, "plan")).toBe(nodeId);
    expect(nodeStore.statusOf(flowId, "plan")).toBe(NODE_STATUS.PENDING);
    expect(nodeStore.idOf(flowId, "missing")).toBeNull();
  });

  it("claim stamps running and rejects double claim", () => {
    const flowId = "flow_ns2";
    const taskId = "task_ns2";
    seedFlow(flowId, taskId);
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_ns2",
      flowId,
      "build",
      "build",
      NODE_STATUS.PENDING,
      now(),
      now(),
    );
    const attempt = nodeStore.claim(flowId, "build", [NODE_STATUS.PENDING]);
    expect(attempt).toMatch(/^att_/);
    expect(nodeStore.statusOf(flowId, "build")).toBe(NODE_STATUS.RUNNING);
    expect(() => nodeStore.claim(flowId, "build", [NODE_STATUS.PENDING])).toThrow(ConflictError);
  });
});

describe("childFlowHasStarted", () => {
  it("treats skipped the same as other started statuses for deletion guards", () => {
    expect(isNodeStarted(NODE_STATUS.SKIPPED)).toBe(true);
    expect(childFlowHasStarted([NODE_STATUS.PENDING])).toBe(false);
    expect(childFlowHasStarted([NODE_STATUS.SKIPPED])).toBe(true);
  });
});
