import { testAll, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { NodeAttemptRegistry } = await import("../nodeAttemptRegistry");
const { TransitionAuthority } = await import("./nodeTransitions");
const { TransitionEvents } = await import("./transitionEvents");
const { NODE_STATUS } = await import("../../constants/nodeStatus");

/**
 * TransitionEvents — the one place that speaks about status changes: the
 * authority's announcements use the per-key templates (silent keys emit
 * nothing), and the typed helpers resolve node keys and use the EVENT_KIND
 * catalog.
 */

const seed = async (flowId: string, nodeKey: string, status: string): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "events test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,'agent',$4,now(),now())`,
    db.uid("node_"), flowId, nodeKey, status,
  );
};

describe("TransitionEvents", () => {
  let authority: InstanceType<typeof TransitionAuthority>;
  let events: InstanceType<typeof TransitionEvents>;

  beforeAll(async () => {
    await resetTestDatabase();
    events = new TransitionEvents();
    authority = new TransitionAuthority(new NodeAttemptRegistry(), events);
  });

  it("an announced transition emits the templated lifecycle line on the node", async () => {
    const flowId = "flw_te_approve";
    await seed(flowId, "plan", NODE_STATUS.AWAITING_APPROVAL);
    await authority.applyOrThrow(flowId, "plan", "approve");
    const rows = await testAll<{ type: string; message: string; nodeId: string | null }>(
      `SELECT e.type, e.message, e.node_id AS "nodeId" FROM events e WHERE e.flow_id=$1 ORDER BY e.created_at DESC`,
      flowId,
    );
    const announced = rows.find((r) => r.message.includes("plan approved"));
    expect(announced?.type).toBe("lifecycle");
    expect(announced?.nodeId).not.toBeNull();
  });

  it("a detail-carrying key renders the call site's context", async () => {
    const flowId = "flw_te_arm";
    await seed(flowId, "resolve", NODE_STATUS.PENDING);
    await authority.apply(flowId, "resolve", "armWait", { detail: "waits for a timer (5 min — the poller resumes it)" });
    const rows = await testAll<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1`, flowId,
    );
    expect(rows.some((r) => r.message === "resolve waits for a timer (5 min — the poller resumes it)")).toBe(true);
  });

  it("silent keys (claims, outcomes) emit nothing through the authority", async () => {
    const flowId = "flw_te_silent";
    await seed(flowId, "agent", NODE_STATUS.PENDING);
    const before = (await testAll<{ id: string }>(`SELECT id FROM events WHERE flow_id=$1`, flowId)).length;
    await authority.claim(flowId, "agent", "runFromPending");
    const after = (await testAll<{ id: string }>(`SELECT id FROM events WHERE flow_id=$1`, flowId)).length;
    expect(after).toBe(before);
  });

  it("the typed helpers emit with the EVENT_KIND catalog", async () => {
    const flowId = "flw_te_typed";
    await seed(flowId, "build", NODE_STATUS.RUNNING);
    await events.error(flowId, "build", "boom");
    await events.lifecycle(flowId, "build", "alive");
    const rows = await testAll<{ type: string; message: string }>(
      `SELECT type, message FROM events WHERE flow_id=$1`, flowId,
    );
    expect(rows.some((r) => r.type === "error" && r.message === "boom")).toBe(true);
    expect(rows.some((r) => r.type === "lifecycle" && r.message === "alive")).toBe(true);
  });
});
