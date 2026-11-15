/**
 * Wait-timer re-arm after restart (CR-006 minimum fix).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine");
const { templateStore } = await import("./templates/templateStore");

const now = () => new Date().toISOString();

describe("reArmWaitingTimers", () => {
  const engine = new FlowEngine();

  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("re-arms a waiting debounced resolve from updated_at + quiet minutes", async () => {
    const taskId = "task_rearm";
    const flowId = "flw_rearm";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "TST-R", "rearm", "open", "task", "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, taskId, "rearm", "active", now(), now(),
    );
    const resolve = (await templateStore.graphForFlow(flowId))?.nodes.find(
      (n: { trigger: { type: string; waitFor?: string }; key: string }) =>
        n.trigger.type === "debounced" && n.trigger.waitFor === "comments",
    );
    if (!resolve) throw new Error("expected debounced resolve node");
    // Prisma-client writes roundtrip DateTime exactly; raw text parameters are
    // reinterpreted by the session timezone, so stamp the wait row here
    const updatedAt = new Date(Date.now() - 11 * 60_000);
    await db.prisma.node.create({
      data: {
        id: "node_rearm",
        flowId,
        nodeKey: resolve.key,
        type: "resolve",
        label: "Resolve",
        config: {},
        joinMode: "all",
        status: "waiting",
        createdAt: updatedAt,
        updatedAt,
      },
    });
    expect(await engine.resolveScheduleAt(flowId)).toBeNull();
    await engine.reArmWaitingTimers();
    const at = await engine.resolveScheduleAt(flowId);
    expect(at).not.toBeNull();
    if (at == null) throw new Error("expected re-armed deadline");
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
