/**
 * JobQueue (engine overhaul step 03, Invariant 7): write-ahead enqueue with
 * dedup, atomic claim (exclusive under concurrent claimers), lease-expiry
 * re-claim, and the bounded attempts→failed budget.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { JobQueue } = await import("./jobQueue");
const { JOB_KIND, JOB_STATUS } = await import("./constants/jobVocabulary");

const queue = () => new JobQueue();

beforeAll(resetTestDatabase);

describe("JobQueue enqueue dedup", () => {
  it("a retried delivery with the same dedup key lands in the same row", async () => {
    const q = queue();
    const first = await q.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      dedupKey: "hook:hk_dedup:msg_1",
      payload: { source: "gitlab", body: {} },
    });
    const retry = await q.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      dedupKey: "hook:hk_dedup:msg_1",
      payload: { source: "gitlab", body: {} },
    });
    expect(first.deduplicated).toBe(false);
    expect(retry.deduplicated).toBe(true);
    const rows = await db.all<{ count: string }>(
      `SELECT COUNT(*) AS count FROM jobs WHERE dedup_key='hook:hk_dedup:msg_1'`);
    expect(Number(rows[0].count)).toBe(1);
  });
});

describe("JobQueue claim exclusivity", () => {
  it("two concurrent claimers never get the same job", async () => {
    const q = queue();
    await q.enqueue({ kind: JOB_KIND.SCHEDULE_FIRE, dedupKey: "template:tpl_x:1", payload: {} });
    await q.enqueue({ kind: JOB_KIND.SCHEDULE_FIRE, dedupKey: "template:tpl_x:2", payload: {} });
    const [a, b] = await Promise.all([
      q.claimNext([JOB_KIND.SCHEDULE_FIRE]),
      q.claimNext([JOB_KIND.SCHEDULE_FIRE]),
    ]);
    if (!a || !b) throw new Error("expected two claimable jobs");
    expect(a.id).not.toBe(b.id);
    // a claimed row is not claimable again — by id or by sweep
    expect(await q.claimById(a.id)).toBeNull();
    expect(await q.claimNext([JOB_KIND.SCHEDULE_FIRE])).toBeNull();
    // kinds without a dispatcher are never claimed by the sweep filters
    expect(await q.claimNext([JOB_KIND.WAIT_FIRE])).toBeNull();
  });
});

describe("JobQueue lease expiry", () => {
  it("a claim whose lease lapsed is reclaimable (crash window)", async () => {
    const q = queue();
    const { id } = await q.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      dedupKey: "hook:hk_lease:msg_1",
      payload: {},
    });
    const first = await q.claimById(id);
    if (!first) throw new Error("expected the enqueued job to be claimable");
    expect(first.attempts).toBe(1);
    // simulate the crash: the claim lease lapses before done
    await db.run(`UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id=$1`, id);
    const reclaimed = await q.reclaimExpired([JOB_KIND.WEBHOOK_DELIVERY]);
    if (!reclaimed) throw new Error("expected the expired claim to be reclaimable");
    expect(reclaimed.id).toBe(id);
    expect(reclaimed.attempts).toBe(2);
  });
});

describe("JobQueue attempts budget", () => {
  it("a failing job requeues with backoff, then lands failed with an event", async () => {
    const q = queue();
    const flowId = "flw_jobfail";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_jobfail", "generic", "TST-J", "jobfail", "open", "task", "P2");
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, "task_jobfail", "jobfail", "active", db.now(), db.now());
    const { id } = await q.enqueue({
      kind: JOB_KIND.SCHEDULE_FIRE,
      flowId,
      dedupKey: "template:tpl_fail:1",
      payload: {},
    });
    let outcome: "requeued" | "failed" = "requeued";
    for (let attempt = 0; attempt < 6; attempt++) {
      const job = (await q.claimById(id)) ?? (await q.reclaimExpired([JOB_KIND.SCHEDULE_FIRE]));
      if (!job) break;
      outcome = await q.fail(id, "boom");
      if (outcome === "failed") break;
    }
    expect(outcome).toBe("failed");
    const row = await db.get<{ status: string }>(`SELECT status FROM jobs WHERE id=$1`, id);
    expect(row?.status).toBe(JOB_STATUS.FAILED);
    const event = await db.get<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='error' AND message LIKE '%schedule_fire%'`,
      flowId);
    expect(event?.message).toContain("failed after 5 attempts");
  });
});

describe("JobQueue sweepDue", () => {
  it("dispatches a claimed job through the handler and marks it done", async () => {
    const q = queue();
    const { id } = await q.enqueue({
      kind: JOB_KIND.SCHEDULE_FIRE,
      dedupKey: "template:tpl_sweep:1",
      payload: {},
    });
    const handled: string[] = [];
    const processed = await q.sweepDue({
      [JOB_KIND.SCHEDULE_FIRE]: async (job) => { handled.push(job.id); },
    });
    expect(processed).toBe(1);
    expect(handled).toEqual([id]);
    const row = await db.get<{ status: string }>(`SELECT status FROM jobs WHERE id=$1`, id);
    expect(row?.status).toBe(JOB_STATUS.DONE);
  });

  it("a handler error requeues the job instead of losing it", async () => {
    const q = queue();
    const { id } = await q.enqueue({
      kind: JOB_KIND.SCHEDULE_FIRE,
      dedupKey: "template:tpl_err:1",
      payload: {},
    });
    await q.sweepDue({
      [JOB_KIND.SCHEDULE_FIRE]: async () => { throw new Error("dispatch exploded"); },
    });
    const row = await db.get<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM jobs WHERE id=$1`, id);
    expect(row?.status).toBe(JOB_STATUS.QUEUED);
    expect(row?.attempts).toBe(1);
  });
});
