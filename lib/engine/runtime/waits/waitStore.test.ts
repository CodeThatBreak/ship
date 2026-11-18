/**
 * WaitStore (engine overhaul step 03, Invariant 2): waits are durable —
 * `armWait` stamps `nodes.wait_until` through the authority in the same
 * statement as the status, webhook waits are indefinite, and the sweep
 * claims-and-fires due waits (a fresh instance resumes them — restart-proof).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { WaitStore } = await import("./waitStore");
const { engineParts } = await import("../../../composition/container");
import type { WaitStoreHost } from "../flowEngineHost";

const seedFlow = async (flowId: string): Promise<void> => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "wait test", "open", "task", "P2",
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

/**
 * The minimal real host: status writes and claims go through the actual
 * transition authority, and `startNodeStage` mirrors the real contract (the
 * `resumeWait` claim happens THERE — the store never pre-claims).
 */
const makeHost = (started: () => void): WaitStoreHost => ({
  nodeStatus: async (flowId, nodeKey) =>
    (await db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey))?.status ?? null,
  setNodeStatus: async (flowId, nodeKey, key, opts) =>
    engineParts.transitions.apply(flowId, nodeKey, key, opts),
  claimNode: async (flowId, nodeKey, key) =>
    (await engineParts.transitions.claim(flowId, nodeKey, key)).attemptId,
  bg: (_flowId, _nodeKey, fn) => { void fn(); },
  nodeConfigFor: async () => ({}),
  chainBusy: async () => false,
  startNodeStage: async (flowId, nodeKey) => {
    try {
      await engineParts.transitions.claim(flowId, nodeKey, "resumeWait");
    } catch {
      return; // a concurrent fire already claimed it — exactly-once
    }
    started();
  },
});

describe("WaitStore durable waits", () => {
  beforeAll(resetTestDatabase);

  it("arming a timer wait stamps wait_until in the armWait transition", async () => {
    const flowId = "flw_ws_timer";
    await seedFlow(flowId);
    await seedNode(flowId, "gate", "pending");
    const store = new WaitStore(makeHost(() => {}), engineParts.events);

    await store.armNodeWait(flowId, "gate", "timer", 5);

    const row = await db.get<{ status: string; waitUntil: Date | null }>(
      `SELECT status, wait_until AS "waitUntil" FROM nodes WHERE flow_id=$1 AND node_key='gate'`,
      flowId);
    expect(row?.status).toBe("waiting");
    if (!row?.waitUntil) throw new Error("expected the armed timer wait to carry a deadline");
    expect(row.waitUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("a webhook wait is indefinite — the sweep never fires it", async () => {
    const flowId = "flw_ws_webhook";
    await seedFlow(flowId);
    await seedNode(flowId, "gate", "pending");
    let started = 0;
    const store = new WaitStore(makeHost(() => { started++; }), engineParts.events);

    await store.armNodeWait(flowId, "gate", "webhook", null);
    expect((await db.get<{ waitUntil: Date | null }>(
      `SELECT wait_until AS "waitUntil" FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.waitUntil
    ).toBeNull();

    await store.sweepDueWaits();
    expect(started).toBe(0);
    expect((await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.status
    ).toBe("waiting");
  });

  it("the sweep fires a due wait exactly once — claim and run in one owner", async () => {
    const flowId = "flw_ws_due";
    await seedFlow(flowId);
    await seedNode(flowId, "gate", "waiting");
    await db.run(
      `UPDATE nodes SET wait_until = now() - interval '1 minute' WHERE flow_id=$1 AND node_key='gate'`,
      flowId);
    let started = 0;
    const store = new WaitStore(makeHost(() => { started++; }), engineParts.events);

    await store.sweepDueWaits(flowId);
    // the fired stage runs in the background (host.bg) — wait for its claim
    await untilStatus(flowId, "gate", "running");
    await store.sweepDueWaits(flowId); // idempotent: a second pass finds nothing waiting

    expect(started).toBe(1);
    expect((await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.status
    ).toBe("running");
  });

  it("a fresh instance (a restarted process) sweeps the same durable deadline", async () => {
    const flowId = "flw_ws_restart";
    await seedFlow(flowId);
    await seedNode(flowId, "gate", "waiting");
    await db.run(
      `UPDATE nodes SET wait_until = now() - interval '1 minute' WHERE flow_id=$1 AND node_key='gate'`,
      flowId);
    let started = 0;

    // the "restarted" store: no shared memory with the arming process —
    // only the table carries the deadline
    const restarted = new WaitStore(makeHost(() => { started++; }), engineParts.events);
    await restarted.sweepDueWaits(flowId);
    await untilStatus(flowId, "gate", "running");

    expect(started).toBe(1);
    expect((await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.status
    ).toBe("running");
  });
});

/** Poll a seeded node's status until it reaches `want` (the fired stage claims async). */
const untilStatus = async (flowId: string, nodeKey: string, want: string): Promise<void> => {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const status = (await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey))?.status;
    if (status === want) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${nodeKey} to be ${want}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
