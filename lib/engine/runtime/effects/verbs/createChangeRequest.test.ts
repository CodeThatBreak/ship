import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../../../db/app");
const { flowEngine } = await import("../../../flowEngine");
const { templateStore } = await import("../../../templates/templateStore");
const { EFFECT_VERB } = await import("../constants/effectVerbs");
const { TRIGGER_SOURCE } = await import("../../triggers/constants/triggerSources");
const { verbRegistry } = await import("./verbWiring");
const { EffectContractViolation } = await import("./effectContractViolation");
const { testAll, testGet, testRun } = await import("@/tests/helpers/rawTestDb");
const { FlowHarness } = await import("@/tests/helpers/flowHarness");
const { registerFakeAgentPort } = await import("@/tests/helpers/fakeAgentPort");
const { registerFakeGitHost } = await import("@/tests/helpers/fakeGitHost");

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

const TEMPLATE_COUNT = { n: 0 };

/** A declarative agent node template with the given config (the verb fixture:
 *  `produces` establishes the branch fact, `effects` declares the verb). */
const seedVerbTemplate = async (config: Record<string, unknown>): Promise<string> => {
  TEMPLATE_COUNT.n += 1;
  const row = await templateStore.createNodeTemplate({
    key: `cr_verb_fixture_${TEMPLATE_COUNT.n}`,
    name: `CR verb fixture ${TEMPLATE_COUNT.n}`,
    kind: "agent",
    config: {
      mode: "plan",
      prompt: "Write the changelog",
      output: "markdown",
      ...config,
    },
  });
  return row.id;
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

describe("create_change_request verb (task 11 — design §4.2, findings A4/F2)", () => {
  it("a declarative node with a branch fact opens the MR on approval and persists it to the branch row", async () => {
    const templateId = await seedVerbTemplate({
      produces: ["branch"],
      effects: { afterApproval: ["create_change_request"] },
    });
    const flowId = await harness.seedInlineFlow(
      [{ key: "changelog", def: templateId, trigger: { type: "approval" } }],
      [],
    );
    agent.pushRun({ status: "finished", result: "# changelog", git: { branches: [{ branch: "feat/changelog" }] } });

    await flowEngine.startNodeStage(flowId, "changelog");
    // the run established the branch fact and held for approval
    expect(await harness.nodeStatus(flowId, "changelog")).toBe("awaiting_approval");
    expect((await branchRow(flowId, "feat/changelog"))?.status).toBe("building");

    await flowEngine.approvals.approveNode(flowId, "changelog");

    // the host saw exactly one create — the verb wrapped MergeRequestService
    const creates = git.calls.filter(
      (c): c is Extract<import("@/tests/helpers/fakeGitHost").GitHostCall, { kind: "createChangeRequest" }> =>
        c.kind === "createChangeRequest",
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.input.sourceBranch).toBe("feat/changelog");

    // the change_request fact persisted into its existing home — the branch row
    const row = await branchRow(flowId, "feat/changelog");
    expect(row?.mr_iid).not.toBeNull();
    expect(row?.mr_url).not.toBeNull();
    expect(row?.status).toBe("approved");

    // the journal: the mr_create job completed in the persist transaction
    const jobs = await mrCreateJobs(flowId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("done");
  });

  it("a node without a branch fact fails with the typed event and the MR is NOT created", async () => {
    const templateId = await seedVerbTemplate({
      effects: { afterApproval: ["create_change_request"] },
    });
    const flowId = await harness.seedInlineFlow(
      [{ key: "changelog", def: templateId, trigger: { type: "approval" } }],
      [],
    );
    agent.pushRun({ status: "finished", result: "# no git work reported" });

    await flowEngine.startNodeStage(flowId, "changelog");
    expect(await harness.nodeStatus(flowId, "changelog")).toBe("awaiting_approval");
    const callsBefore = git.calls.length;

    await expect(flowEngine.approvals.approveNode(flowId, "changelog")).rejects.toThrow(EffectContractViolation);

    // the typed event names the verb and the missing fact, on the node
    const events = await harness.events(flowId, { nodeKey: "changelog", type: "effect_contract_violation" });
    expect(events).toHaveLength(1);
    const data = await testGet<{ data: { verb: string; fact: string; nodeKey: string } }>(
      `SELECT data FROM events WHERE flow_id=$1 AND type='effect_contract_violation'`,
      flowId,
    );
    expect(data?.data).toMatchObject({ verb: EFFECT_VERB.CREATE_CHANGE_REQUEST, fact: "branch", nodeKey: "changelog" });

    // no half-established fact: no host call, no journal job, no branch row
    expect(git.calls.length).toBe(callsBefore);
    expect(await mrCreateJobs(flowId)).toHaveLength(0);
    expect(await testAll(`SELECT id FROM branches WHERE flow_id=$1`, flowId)).toHaveLength(0);
  });

  it("an explicit branchName override targets the named branch fact", async () => {
    const templateId = await seedVerbTemplate({
      effects: { afterApproval: ["create_change_request"] },
    });
    const flowId = await harness.seedInlineFlow(
      [{ key: "changelog", def: templateId, trigger: { type: "manual" } }],
      [],
    );
    // two branch facts; the override names the OLDER one, not the latest
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

    const ran = await verbRegistry.run(EFFECT_VERB.CREATE_CHANGE_REQUEST, {
      flowId,
      nodeKey: "changelog",
      defKey: templateId,
      status: "approved",
      output: null,
      source: TRIGGER_SOURCE.UI,
      params: { branchName: "feat/old" },
    });

    expect(ran).toBe(true);
    expect((await branchRow(flowId, "feat/old"))?.mr_iid).not.toBeNull();
    expect((await branchRow(flowId, "feat/new"))?.mr_iid).toBeNull();
  });
});
