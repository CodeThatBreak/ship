/**
 * Webhook poison handling (engine overhaul step 06, task 7): a delivery whose
 * handler always throws must NOT keep the sender retrying. The route answers
 * HTTP 200 with `{ok, delivery}` and hands ownership to the job queue — which
 * requeues with backoff until JOB_LIMITS.MAX_ATTEMPTS, then lands the job
 * `failed` and emits a typed `error` event on the flow (kind + error in the
 * message). This file pins the queue + event semantics of that trade; the
 * route mapping itself is a two-line change (200-on-poison instead of
 * `toErrorResponse`) verified by reading — this repo has no route-level
 * testing precedent.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { JobQueue } = await import("@/lib/engine/runtime/jobs/jobQueue");
const { JOB_KIND, JOB_LIMITS, JOB_STATUS } = await import("@/lib/engine/runtime/jobs/constants/jobVocabulary");
const { hookDeliveryDedupKey } = await import("@/lib/engine/runtime/jobs/utils/jobDedupKeys");
const { EVENT_KIND } = await import("@/lib/engine/constants/vocabulary");

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

/** The dispatch never succeeds — every attempt throws. */
const poisonHandler = async (): Promise<never> => {
  throw new Error("poison delivery");
};

describe("webhook poison handling", () => {
  test("a handler that always throws exhausts its attempts, lands failed and emits a typed error event on the flow", async () => {
    const flowId = await harness.seedFlowFromTemplate(null);

    // write-ahead enqueue + claim (what the hooks route does)
    const jobs = new JobQueue();
    const { id: jobId, deduplicated } = await jobs.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      flowId,
      dedupKey: hookDeliveryDedupKey("hk_poison", "msg_poison_1"),
      payload: {
        source: "hook",
        hookId: "hk_poison",
        templateId: null,
        flowId,
        nodeKey: "plan",
        body: { delivery: true },
      },
    });
    expect(deduplicated).toBe(false);

    // the handler throws on every attempt — the sweep requeues with backoff
    // until the attempt cap, then lands the job `failed`
    for (let i = 0; i < JOB_LIMITS.MAX_ATTEMPTS; i += 1) {
      // one sweep cycle: make the requeued job due again, then sweep
      await testRun(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id=$1`, jobId);
      await jobs.sweepDue({ [JOB_KIND.WEBHOOK_DELIVERY]: poisonHandler });
    }
    const jobRow = await testGet<{ status: string }>(`SELECT status FROM jobs WHERE id=$1`, jobId);
    expect(jobRow?.status).toBe(JOB_STATUS.FAILED);

    // the failure is loud in OUR event feed: one typed `error` event carrying
    // the job kind, the attempt budget and the handler error
    const events = await testAll<{ type: string; message: string }>(
      `SELECT type, message FROM events WHERE flow_id=$1 AND type=$2 ORDER BY created_at`,
      flowId,
      EVENT_KIND.ERROR,
    );
    expect(events.length).toBe(1);
    expect(events[0]?.message).toContain(`job ${JOB_KIND.WEBHOOK_DELIVERY} (${jobId})`);
    expect(events[0]?.message).toContain(`failed after ${JOB_LIMITS.MAX_ATTEMPTS} attempts`);
    expect(events[0]?.message).toContain("poison delivery");
  }, 15_000);
});
