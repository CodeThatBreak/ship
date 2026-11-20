/**
 * ProcessLock (engine overhaul step 03): the Postgres advisory lock gating
 * the single writer process — exclusive acquire, non-holder refusal, and the
 * cross-process `pg_locks` visibility the health route reads.
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { ProcessLock } = await import("./processLock");
const { writerLockHeld } = await import("./utils/writerLockStatus");

beforeAll(resetTestDatabase);

describe("ProcessLock exclusivity", () => {
  it("a non-holder cannot acquire while the holder keeps the lock", async () => {
    const holder = new ProcessLock();
    const contender = new ProcessLock();
    expect(await holder.acquire()).toBe(true);
    expect(holder.held).toBe(true);
    expect(holder.since).not.toBeNull();
    try {
      // the contender must fail fast — never block, never throw
      expect(await contender.acquire()).toBe(false);
      expect(contender.held).toBe(false);
      // shared truth: any connection sees the holder through pg_locks
      expect(await writerLockHeld(db.prisma)).toBe(true);
    } finally {
      await holder.release();
    }
    expect(holder.held).toBe(false);
    expect(await writerLockHeld(db.prisma)).toBe(false);
    // released → the contender can take over (worker failover)
    expect(await contender.acquire()).toBe(true);
    await contender.release();
  });
});

describe("poller refuses to tick without the lock", () => {
  it("a non-holder never fires due waits; the holder does", async () => {
    const { FlowPoller } = await import("../flowPoller");
    const flowId = "flw_lock_tick";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_lock_tick", "generic", "TST-L", "lock tick", "open", "task", "P2");
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
      flowId, "task_lock_tick", "lock tick", "active");
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, wait_until, created_at, updated_at)
       VALUES ($1,$2,'gate','agent','waiting', now() - interval '1 minute', now(), now())`,
      db.uid("node_"), flowId);

    // a non-holder starts the poller: ticks must idle (single-writer gate)
    const nonHolder = new ProcessLock();
    const poller = new FlowPoller(nonHolder);
    poller.start(20);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((await testGet<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.status
    ).toBe("waiting");

    // the holder's tick does the work
    const holder = new ProcessLock();
    expect(await holder.acquire()).toBe(true);
    try {
      const holderPoller = new FlowPoller(holder);
      holderPoller.start(20);
      const deadline = Date.now() + 5_000;
      let status = "waiting";
      while (Date.now() < deadline) {
        status = (await testGet<{ status: string }>(
          `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))?.status ?? status;
        if (status !== "waiting") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(status).not.toBe("waiting");
    } finally {
      await holder.release();
    }
  }, 15_000);
});
