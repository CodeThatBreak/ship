/**
 * FlowReadModel.get: artifact rows omit bodies for lazy fetch via
 * GET /api/artifacts/:id, and a node's artifacts load in one batched query.
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowReadModel } = await import("./flowReadModel");
const { WaitStore } = await import("./waits/waitStore");
const { engineParts } = await import("@/lib/composition/container");

const now = () => new Date().toISOString();

describe("FlowReadModel.get", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("returns artifact metadata without content bodies in one batched query", async () => {
    const taskId = "task_rm";
    const flowId = "flw_rm";
    const nodeId = "node_1";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "RM-1", "read model", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, taskId, "read model", "active", now(), now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      nodeId, flowId, "plan", "plan", "done", now(), now(),
    );
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      "art_1", nodeId, flowId, "plan", 1, "# Large plan body", "draft", now(),
    );

    const host = {
      nodeStatus: async () => "",
      setNodeStatus: async () => false,
      claimNode: async () => "attempt",
      bg: () => {},
      nodeConfigFor: async () => ({}),
      chainBusy: async () => false,
      startNodeStage: async () => {},
    };
    const waits = new WaitStore(host, engineParts.events);
    const readModel = new FlowReadModel(waits);

    const artifactFindMany = vi.spyOn(db.prisma.artifact, "findMany");

    const snapshot = await readModel.get(flowId);
    expect(snapshot).not.toBeNull();

    const planNode = snapshot?.nodes.find((n) => n.nodeKey === "plan");
    expect(planNode?.artifacts[0]?.id).toBe("art_1");
    expect(planNode?.artifacts[0]).not.toHaveProperty("content");

    /** A Prisma `findMany` whose `where` carries an `IN` filter = one batched query. */
    const batchedInWhere = (args: unknown): boolean => {
      const where = (args as { where?: Record<string, unknown> } | undefined)?.where;
      return Object.values(where ?? {}).some(
        (v) => typeof v === "object" && v !== null && "in" in v,
      );
    };
    expect(artifactFindMany.mock.calls.some((c) => batchedInWhere(c[0]))).toBe(true);

    artifactFindMany.mockRestore();
  });
});
