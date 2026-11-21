/**
 * Task 17 — the "Retrigger pipeline" panel action through the flow-action
 * route (design §4.2 use case 6). The action claims through the
 * TriggerGateway's transition door — the `panelVerb` row's terminal from-set
 * IS the fence (Invariant 11: a concurrent click loses atomically with the
 * typed skip event) — and runs the `retrigger_pipeline` verb under that
 * claim: the verb presses retry on the gate's recorded pipeline over the git
 * host port (`retryPipeline` — the surface no gate path called before).
 *
 * The built-in door: `retrigger_pipeline` is offered on the built-in pipeline
 * def only (`PANEL_VERB_BUILTIN_DEFS`) — no declarative `effects` config
 * exists there, so the verb's own required-fact contract is the capability:
 * without an established `change_request` fact (or the node's recorded
 * pipeline id) it refuses loudly with the typed
 * `effect_contract_violation` event naming the verb and the missing fact
 * (task 11's refusal shape), and no host call happens.
 *
 * Runs against the isolated dockerized Postgres test database (AGENTS.md §1 —
 * never a demo/real database).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { EFFECT_VERB } = await import("@/lib/engine/runtime/effects/constants/effectVerbs");
const { FLOW_ACTION, FLOW_STATUS } = await import("@/constants/flow");
const { testGet, testRun } = await import("@/tests/helpers/rawTestDb");
const { FlowHarness } = await import("@/tests/helpers/flowHarness");
const { registerFakeGitHost } = await import("@/tests/helpers/fakeGitHost");
const { POST } = await import("@/app/api/flows/[id]/action/route");

let git: import("@/tests/helpers/fakeGitHost").FakeGitHost;
let harness: import("@/tests/helpers/flowHarness").FlowHarness;

beforeAll(async () => {
  await resetTestDatabase();
  git = registerFakeGitHost();
  harness = new FlowHarness({ db, flowEngine, templateStore });
});

/** A built-in pipeline-gate node parked at its failed terminal with the
 *  recorded pipeline id (fixture setup ONLY — assertions read through the
 *  engine, mirroring the panelVerbAction seeding). The pipeline id is a real
 *  fake-host pipeline so the retry lands; an explicit output overrides the
 *  recorded shape (the no-pipeline-id refusal case). */
const seedFailedGate = async (output?: Record<string, unknown>): Promise<{ flowId: string; nodeKey: string; pipelineId: number }> => {
  const pipelineId = git.addPipeline("failed");
  const flowId = await harness.seedInlineFlow([{ key: "pipeline", def: "nt_pipeline" }], []);
  await harness.setNodeOutputForFixture(flowId, "pipeline", FLOW_STATUS.FAILED, output ?? {
    pipelineId,
    status: "failed",
    fixes: 2,
  });
  return { flowId, nodeKey: "pipeline", pipelineId };
};

/** The established `change_request` fact — a branch row carrying its MR
 *  (`FactStore.changeRequestFact`'s latest-with-MR resolution). */
const seedChangeRequestFact = async (flowId: string, branch: string, mrIid: number): Promise<void> => {
  await testRun(
    `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at, mr_iid, mr_url)
     VALUES ($1,$2,$3,$3,'approved',$4,$4,$5,$6)`,
    db.uid("br_"), flowId, branch, "2026-01-01T00:00:00Z", mrIid, `https://git.example.com/mr/${mrIid}`,
  );
};

const retryCalls = () =>
  git.calls.filter(
    (c): c is Extract<import("@/tests/helpers/fakeGitHost").GitHostCall, { kind: "retryPipeline" }> =>
      c.kind === "retryPipeline",
  );

/** Invoke the route handler directly — params come as a Promise in Next 15. */
const callAction = (flowId: string, body: unknown): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/flows/${flowId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: flowId }) },
  );

describe("Retrigger pipeline panel action (task 17 — design §4.2 use case 6)", () => {
  it("the action claims the panelVerb trigger and retries the recorded pipeline on the host", async () => {
    const { flowId, nodeKey, pipelineId } = await seedFailedGate();
    await seedChangeRequestFact(flowId, "feat/gate", 11);
    const before = retryCalls().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.RETRIGGER_PIPELINE, nodeKey });
    expect(res.status).toBe(200);

    // the host saw exactly one retry, for the pipeline the gate recorded
    const retries = retryCalls();
    expect(retries.length).toBe(before + 1);
    expect(retries[before]?.pipelineId).toBe(pipelineId);

    // the claim went through the gateway's transition door (Invariant 11)
    const claims = flowEngine.transitions.records(flowId).filter((r) => r.key === "panelVerb");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.actor).toBe("user");
    // the verb never touches node status — the failed terminal is preserved
    // (the re-check action owns the gate's re-run)
    expect(await harness.nodeStatus(flowId, nodeKey)).toBe(FLOW_STATUS.FAILED);
  });

  it("without a change_request fact the verb fails loudly — no host call", async () => {
    const { flowId, nodeKey } = await seedFailedGate();
    const before = retryCalls().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.RETRIGGER_PIPELINE, nodeKey });
    expect(res.status).toBe(500);

    // the typed event names the verb and the missing fact, on the node
    const events = await harness.events(flowId, { nodeKey, type: "effect_contract_violation" });
    expect(events).toHaveLength(1);
    const data = await testGet<{ data: { verb: string; fact: string; nodeKey: string } }>(
      `SELECT data FROM events WHERE flow_id=$1 AND type='effect_contract_violation'`,
      flowId,
    );
    expect(data?.data).toMatchObject({ verb: EFFECT_VERB.RETRIGGER_PIPELINE, fact: "change_request", nodeKey });

    expect(retryCalls().length).toBe(before);
  });

  it("without a recorded pipeline id the verb fails loudly the same way", async () => {
    const { flowId, nodeKey } = await seedFailedGate({ status: "failed", fixes: 0 });
    await seedChangeRequestFact(flowId, "feat/gate", 12);
    const before = retryCalls().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.RETRIGGER_PIPELINE, nodeKey });
    expect(res.status).toBe(500);
    const events = await harness.events(flowId, { nodeKey, type: "effect_contract_violation" });
    expect(events).toHaveLength(1);
    expect(retryCalls().length).toBe(before);
  });

  it("the built-in door refuses a non-pipeline node before any claim", async () => {
    const flowId = await harness.seedInlineFlow([{ key: "build", def: "nt_build" }], []);
    await harness.setNodeOutputForFixture(flowId, "build", FLOW_STATUS.FAILED, { pipelineId: 3 });
    const before = retryCalls().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.RETRIGGER_PIPELINE, nodeKey: "build" });
    expect(res.status).toBe(400);
    expect(retryCalls().length).toBe(before);
    expect(await harness.nodeStatus(flowId, "build")).toBe(FLOW_STATUS.FAILED);
  });

  it("an unknown node is a 404", async () => {
    const res = await callAction("flw_missing", {
      action: FLOW_ACTION.RETRIGGER_PIPELINE,
      nodeKey: "pipeline",
    });
    expect(res.status).toBe(404);
  });
});
