/**
 * Webhook crash window (engine overhaul step 03, Invariant 7): a delivery is
 * journaled write-ahead through the job queue — enqueue (dedup key), claim,
 * dispatch, mark done. A crash between dispatch and done leaves a `claimed`
 * job whose lease expiry re-claims and re-dispatches it; the resume claim
 * itself dedups the side effect, so the node runs EXACTLY once.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { JobQueue } = await import("@/lib/engine/runtime/jobs/jobQueue");
const { WebhookDeliveryHandler } = await import("@/lib/engine/runtime/jobs/webhookDeliveryHandler");
const { JOB_KIND } = await import("@/lib/engine/runtime/jobs/constants/jobVocabulary");
const { hookDeliveryDedupKey } = await import("@/lib/engine/runtime/jobs/utils/jobDedupKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const webhookWaitYaml = `
name: Overhaul crash window
trigger:
  type: manual
nodes:
  - key: entry
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
  - key: gate
    type: agent
    trigger:
      type: auto
      wait_for: webhook
    config:
      mode: plan
      output: markdown
      prompt: "Ack the delivery."
edges:
  - [entry, gate]
`;

describe("webhook delivery crash window", () => {
  test("a crash between dispatch and done re-claims and re-dispatches without a second run", async () => {
    const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");
    const { id: templateId } = await importTemplateYaml(templateStore, webhookWaitYaml, {
      namePrefix: "ovh-crash-window",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);
    await harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(await harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // the dispatched stage runs one agent turn — script its outcome
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "delivery acknowledged." });

    // the delivery: write-ahead enqueue + claim (what the hooks route does)
    const jobs = new JobQueue();
    const webhookId = "msg_crash_1";
    const { id: jobId, deduplicated } = await jobs.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      flowId,
      dedupKey: hookDeliveryDedupKey("hk_crash", webhookId),
      payload: {
        source: "hook",
        hookId: "hk_crash",
        templateId: null,
        flowId,
        nodeKey: "gate",
        body: { delivery: true },
      },
    });
    expect(deduplicated).toBe(false);
    // a retried delivery re-enqueues into the same row
    const retry = await jobs.enqueue({
      kind: JOB_KIND.WEBHOOK_DELIVERY,
      flowId,
      dedupKey: hookDeliveryDedupKey("hk_crash", webhookId),
      payload: { source: "hook", hookId: "hk_crash", templateId: null, flowId, nodeKey: "gate", body: {} },
    });
    expect(retry.deduplicated).toBe(true);

    const first = await jobs.claimById(jobId);
    if (!first) throw new Error("expected the delivery job to be claimable");

    // dispatch #1 succeeds … then the process CRASHES before `complete`
    await new WebhookDeliveryHandler().handle(first);
    await until(
      async () => (await harness.nodeStatus(flowId, "gate")) === "done",
      "the first dispatch to run the gate to done",
    );

    // crash window: the claim lease lapses; the sweep re-claims and re-dispatches
    await testRun(`UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id=$1`, jobId);
    const reclaimed = await jobs.reclaimExpired([JOB_KIND.WEBHOOK_DELIVERY]);
    if (!reclaimed) throw new Error("expected the crashed claim to be reclaimable");
    expect(reclaimed.id).toBe(jobId);
    await new WebhookDeliveryHandler().handle(reclaimed); // must NOT re-run the node
    await jobs.complete(jobId);

    // exactly-once: one resume announcement, one run of the gate
    const resumed = await testAll<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='lifecycle' AND message LIKE '%resumed by a webhook delivery%'`,
      flowId);
    expect(resumed.length).toBe(1);
    expect(await harness.nodeStatus(flowId, "gate")).toBe("done");
    const jobRow = await testGet<{ status: string }>(`SELECT status FROM jobs WHERE id=$1`, jobId);
    expect(jobRow?.status).toBe("done");
  }, 15_000);
});
