/**
 * Task 12 — the "Open PR" panel action through the flow-action route (the
 * seam the panel button's click lands on). The action claims through the
 * TriggerGateway's transition door — the `panelVerb` row's terminal from-set
 * IS the fence (Invariant 11: a concurrent click loses atomically with the
 * typed skip event) — and runs the declarative `create_change_request` verb
 * under that claim, the same verb the approval's wildcard effect dispatches.
 * A MANUAL fire needs no `effects` declaration (that gates only the automatic
 * after-approval dispatch) — the verb's own required-fact contract is the
 * capability, so a node whose branch fact is missing fails loudly in the
 * verb; a non-declarative kind never reaches the claim.
 *
 * Seeding mirrors the co-located verb test (`createChangeRequest.test.ts`):
 * the fake agent port establishes the branch fact, the fake git host records
 * the creation. Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real database).
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
const { FLOW_ACTION } = await import("@/constants/flow");
const { testAll, testGet, testRun } = await import("@/tests/helpers/rawTestDb");
const { FlowHarness } = await import("@/tests/helpers/flowHarness");
const { registerFakeAgentPort } = await import("@/tests/helpers/fakeAgentPort");
const { registerFakeGitHost } = await import("@/tests/helpers/fakeGitHost");
const { POST } = await import("@/app/api/flows/[id]/action/route");

let agent: import("@/tests/helpers/fakeAgentPort").FakeAgentPort;
let git: import("@/tests/helpers/fakeGitHost").FakeGitHost;
let harness: import("@/tests/helpers/flowHarness").FlowHarness;

beforeAll(async () => {
  await resetTestDatabase();
  agent = registerFakeAgentPort((value) => {
    void db.setSetting("default_harness", value);
  });
  await db.setSetting("default_harness", agent.harness);
  git = registerFakeGitHost();
  harness = new FlowHarness({ db, flowEngine, templateStore });
});

const fixtureCount = { n: 0 };

/** A declarative agent node template with the given config, seeded on an
 *  auto-trigger flow: one run establishes the branch fact and lands `done`. */
const seedDeclarativeFlow = async (config: Record<string, unknown>): Promise<{ flowId: string; nodeKey: string }> => {
  fixtureCount.n += 1;
  const row = await templateStore.createNodeTemplate({
    key: `panel_verb_fixture_${fixtureCount.n}`,
    name: `Panel verb fixture ${fixtureCount.n}`,
    kind: "agent",
    config: {
      mode: "plan",
      prompt: "Write the changelog",
      output: "markdown",
      ...config,
    },
  });
  const flowId = await harness.seedInlineFlow(
    [{ key: "changelog", def: row.id, trigger: { type: "auto" } }],
    [],
  );
  return { flowId, nodeKey: "changelog" };
};

const runToBranchFact = async (flowId: string, nodeKey: string, branch: string): Promise<void> => {
  agent.pushRun({ status: "finished", result: "# changelog", git: { branches: [{ branch }] } });
  await flowEngine.startNodeStage(flowId, nodeKey);
  expect(await harness.nodeStatus(flowId, nodeKey)).toBe("done");
};

const branchRow = async (flowId: string, name: string) =>
  testGet<{ mr_iid: number | null; mr_url: string | null; status: string }>(
    `SELECT mr_iid, mr_url, status::text AS status FROM branches WHERE flow_id=$1 AND name=$2`,
    flowId,
    name,
  );

const mrCreateJobs = async (flowId: string) =>
  testAll<{ id: string; status: string }>(
    `SELECT id, status::text AS status FROM jobs WHERE flow_id=$1 AND kind='mr_create' ORDER BY id`,
    flowId,
  );

const gitCreates = () =>
  git.calls.filter(
    (c): c is Extract<import("@/tests/helpers/fakeGitHost").GitHostCall, { kind: "createChangeRequest" }> =>
      c.kind === "createChangeRequest",
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

describe("Open PR panel action (task 12 — design §4.2 use case 4)", () => {
  it("the action claims the panelVerb trigger and runs the create_change_request verb", async () => {
    const { flowId, nodeKey } = await seedDeclarativeFlow({
      produces: ["branch"],
      effects: { afterApproval: ["create_change_request"] },
    });
    await runToBranchFact(flowId, nodeKey, "feat/changelog");
    const before = gitCreates().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.CREATE_CHANGE_REQUEST, nodeKey });
    expect(res.status).toBe(200);

    // the verb ran under the claimed trigger — the host saw exactly one create
    const creates = gitCreates();
    expect(creates.length).toBe(before + 1);
    expect(creates[before]?.input.sourceBranch).toBe("feat/changelog");

    // the change_request fact persisted into its existing home — the branch row
    const row = await branchRow(flowId, "feat/changelog");
    expect(row?.mr_iid).not.toBeNull();
    expect(row?.mr_url).not.toBeNull();

    // the journal: the mr_create job completed in the persist transaction
    const jobs = await mrCreateJobs(flowId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("done");

    // the claim went through the gateway's transition door (Invariant 11)
    const claims = flowEngine.transitions.records(flowId).filter((r) => r.key === "panelVerb");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.actor).toBe("user");
    // the verb never touches node status — the terminal is preserved
    expect(await harness.nodeStatus(flowId, nodeKey)).toBe("done");
  });

  it("a live run owns the branch — the fence refuses with 409", async () => {
    const { flowId, nodeKey } = await seedDeclarativeFlow({
      produces: ["branch"],
      effects: { afterApproval: ["create_change_request"] },
    });
    // fixture-only state: a mid-run node (its branch fact came from a prior run)
    await runToBranchFact(flowId, nodeKey, "feat/first");
    await harness.setNodeForFixture(flowId, nodeKey, "running");
    const before = gitCreates().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.CREATE_CHANGE_REQUEST, nodeKey });
    expect(res.status).toBe(409);
    expect(gitCreates().length).toBe(before);
  });

  it("a manual fire needs no declaration — the declarative-kind door accepts the fact-driven verb", async () => {
    // the node's config carries NO `effects` declaration; the node finishes
    // (no git work) and the branch fact is seeded directly, so the test is
    // independent of the agent-run queue. The manual fire claims through the
    // gateway and runs the verb off the established fact — the declaration
    // gates only the automatic after-approval dispatch, never this door. (The
    // verb's own fact requirement is covered by the co-located verb test and
    // the first test here.)
    const { flowId, nodeKey } = await seedDeclarativeFlow({ produces: ["branch"] });
    agent.pushRun({ status: "finished", result: "# no git work reported" });
    await flowEngine.startNodeStage(flowId, nodeKey);
    await testRun(
      `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at)
       VALUES ($1,$2,$3,$3,'building',$4,$4)`,
      db.uid("br_"), flowId, "feat/undeclared", "2026-01-01T00:00:00Z",
    );

    const res = await callAction(flowId, { action: FLOW_ACTION.CREATE_CHANGE_REQUEST, nodeKey });
    // accepted (the claim won) — not the 400 declaration refusal of before
    expect(res.status).toBe(200);
    // the verb claimed through the gateway's panelVerb transition door
    const claims = flowEngine.transitions.records(flowId).filter((r) => r.key === "panelVerb");
    expect(claims).toHaveLength(1);
  });

  it("a declared verb without a branch fact fails loudly — no half-established fact", async () => {
    const { flowId, nodeKey } = await seedDeclarativeFlow({
      effects: { afterApproval: ["create_change_request"] },
    });
    agent.pushRun({ status: "finished", result: "# no git work reported" });
    await flowEngine.startNodeStage(flowId, nodeKey);
    const before = gitCreates().length;

    const res = await callAction(flowId, { action: FLOW_ACTION.CREATE_CHANGE_REQUEST, nodeKey });
    expect(res.status).toBe(500);

    // the typed event names the verb and the missing fact, on the node
    const events = await harness.events(flowId, { nodeKey, type: "effect_contract_violation" });
    expect(events).toHaveLength(1);
    const data = await testGet<{ data: { verb: string; fact: string; nodeKey: string } }>(
      `SELECT data FROM events WHERE flow_id=$1 AND type='effect_contract_violation'`,
      flowId,
    );
    expect(data?.data).toMatchObject({ verb: EFFECT_VERB.CREATE_CHANGE_REQUEST, fact: "branch", nodeKey });

    // no host call, no journal job, no branch row
    expect(gitCreates().length).toBe(before);
    expect(await mrCreateJobs(flowId)).toHaveLength(0);
    expect(await testAll(`SELECT id FROM branches WHERE flow_id=$1`, flowId)).toHaveLength(0);
  });

  it("an unknown node is a 404", async () => {
    const res = await callAction("flw_missing", {
      action: FLOW_ACTION.CREATE_CHANGE_REQUEST,
      nodeKey: "changelog",
    });
    expect(res.status).toBe(404);
  });

  it("an explicit branch override targets the named branch fact", async () => {
    const { flowId, nodeKey } = await seedDeclarativeFlow({
      produces: ["branch"],
      effects: { afterApproval: ["create_change_request"] },
    });
    // the node finishes without git work (no auto branch rows), then two
    // branch facts are seeded as fixtures; the override names the OLDER one,
    // not the latest
    agent.pushRun({ status: "finished", result: "# changelog" });
    await flowEngine.startNodeStage(flowId, nodeKey);
    await testRun(
      `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at)
       VALUES ($1,$2,$3,$3,'building',$4,$4)`,
      db.uid("br_"), flowId, "feat/old", "2026-01-01T00:00:00Z",
    );
    await testRun(
      `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at)
       VALUES ($1,$2,$3,$3,'building',$4,$4)`,
      db.uid("br_"), flowId, "feat/new", "2026-02-01T00:00:00Z",
    );
    const before = gitCreates().length;

    const res = await callAction(flowId, {
      action: FLOW_ACTION.CREATE_CHANGE_REQUEST,
      nodeKey,
      branch: "feat/old",
    });
    expect(res.status).toBe(200);
    // the host's create rides the flow's branch-name prefix — the override
    // picked the OLDER fact, not the latest
    expect(gitCreates()[before]?.input.sourceBranch).toContain("feat/old");
    expect((await branchRow(flowId, "feat/old"))?.mr_iid).not.toBeNull();
    expect((await branchRow(flowId, "feat/new"))?.mr_iid).toBeNull();
  });
});
