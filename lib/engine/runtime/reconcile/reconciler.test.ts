/**
 * Reconciler v2 — the `running` row of the matrix and the RecoveryDriver's
 * lease liveness (engine overhaul step 03, Invariant 3): lease-current nodes
 * are left alone, expired leases recover (or fail manually when nothing is
 * recoverable), and fan-out aggregates parked over active child flows are
 * recognized as alive from durable state — never from in-process handles.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { Reconciler } = await import("./reconciler");

const seedFlow = async (flowId: string): Promise<void> => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "reconcile test", "open", "task", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
};

const seedNode = async (flowId: string, nodeKey: string, status: string): Promise<string> => {
  const nodeId = db.uid("node_");
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,'agent',$4,now(),now())`,
    nodeId, flowId, nodeKey, status,
  );
  return nodeId;
};

describe("Reconciler running-state liveness", () => {
  const reconciler = new Reconciler();

  beforeAll(resetTestDatabase);

  it("a running node with a current lease is left alone", async () => {
    const flowId = "flw_rc_alive";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "build", "running");
    await db.run(`UPDATE nodes SET lease_until = now() + interval '5 minutes' WHERE id=$1`, nodeId);

    await reconciler.reconcileFlow(flowId);

    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status)
      .toBe("running");
  });

  it("a running node whose RUN lease is current is left alone (cross-process liveness)", async () => {
    const flowId = "flw_rc_runlease";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "build", "running");
    // the node lease lapsed, but the run row's lease is still heartbeated by
    // the process executing the run (the worker reconciles web-owned runs)
    await db.run(`UPDATE nodes SET lease_until = now() - interval '5 minutes' WHERE id=$1`, nodeId);
    await db.run(
      `INSERT INTO runs (id, flow_id, node_id, agent_ref, run_ref, status, lease_until, created_at, updated_at)
       VALUES ($1,$2,$3,'agt_rc','run_rc','running', now() + interval '2 minutes', now(), now())`,
      db.uid("run_"), flowId, nodeId);

    await reconciler.reconcileFlow(flowId);

    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status)
      .toBe("running");
  });

  it("an expired lease with no run row fails manually with a typed event", async () => {
    const flowId = "flw_rc_expired";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "build", "running");
    await db.run(`UPDATE nodes SET lease_until = now() - interval '5 minutes' WHERE id=$1`, nodeId);

    await reconciler.reconcileFlow(flowId);

    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status)
      .toBe("failed");
    const event = await db.get<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='error' AND message LIKE '%left running without an active run%'`,
      flowId);
    expect(event?.message).toContain("retry the node to continue");
  });

  it("a fan-out aggregate parked over active child flows is alive (durable evidence, no guessing)", async () => {
    const flowId = "flw_rc_aggregate";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "build", "running");
    await db.run(`UPDATE nodes SET lease_until = now() - interval '5 minutes' WHERE id=$1`, nodeId);
    // the aggregate's children are still working — that is the liveness
    await seedFlow("flw_rc_aggregate_child");
    await db.run(
      `UPDATE flows SET parent_flow_id=$1, kind='step' WHERE id='flw_rc_aggregate_child'`,
      flowId);

    await reconciler.reconcileFlow(flowId);

    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status)
      .toBe("running");
  });
});
