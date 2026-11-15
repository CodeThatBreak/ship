import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { nodeStore } = await import('./nodeStore');
const { NODE_STATUS } = await import("../constants/nodeStatus");
const { isNodeStarted, childFlowHasStarted } = await import("../constants/nodeStatus");
const { ConflictError } = await import("../../errors");

const seedFlow = async (flowId: string, taskId: string) => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    taskId.toUpperCase(),
    "node store",
    "open",
    "task",
    "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId,
    taskId,
    "t",
    "active",
  );
};

describe("NodeStore", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("idOf and statusOf read node rows", async () => {
    const flowId = "flow_ns1";
    const taskId = "task_ns1";
    await seedFlow(flowId, taskId);
    const nodeId = "node_ns1";
    await db.prisma.node.create({
      data: {
        id: nodeId,
        flowId,
        nodeKey: "plan",
        type: "plan",
        status: NODE_STATUS.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    expect(await nodeStore.idOf(flowId, "plan")).toBe(nodeId);
    expect(await nodeStore.statusOf(flowId, "plan")).toBe(NODE_STATUS.PENDING);
    expect(await nodeStore.idOf(flowId, "missing")).toBeNull();
  });

  it("claim stamps running and rejects double claim", async () => {
    const flowId = "flow_ns2";
    const taskId = "task_ns2";
    await seedFlow(flowId, taskId);
    await db.prisma.node.create({
      data: {
        id: "node_ns2",
        flowId,
        nodeKey: "build",
        type: "build",
        status: NODE_STATUS.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const attempt = await nodeStore.claim(flowId, "build", [NODE_STATUS.PENDING]);
    expect(attempt).toMatch(/^att_/);
    expect(await nodeStore.statusOf(flowId, "build")).toBe(NODE_STATUS.RUNNING);
    await expect(nodeStore.claim(flowId, "build", [NODE_STATUS.PENDING])).rejects.toThrow(ConflictError);
  });
});

describe("childFlowHasStarted", () => {
  it("treats skipped the same as other started statuses for deletion guards", () => {
    expect(isNodeStarted(NODE_STATUS.SKIPPED)).toBe(true);
    expect(childFlowHasStarted([NODE_STATUS.PENDING])).toBe(false);
    expect(childFlowHasStarted([NODE_STATUS.SKIPPED])).toBe(true);
  });
});
