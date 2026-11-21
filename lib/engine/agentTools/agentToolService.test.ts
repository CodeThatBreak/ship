/**
 * AgentToolService (step 08, Invariant 10): token lifecycle (minted by the
 * authority's claim, validated against the run row, dead once the attempt
 * loses the node), capability gating (the kind's `agentTools()` allowlist),
 * the checklist-claim tool's idempotency, and `report_failure`'s one-shot
 * bound.
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { engineParts } = await import("@/lib/composition/container");
const { NODE_KEYS } = await import("../constants/nodeKeys");
const { NODE_STATUS } = await import("../constants/nodeStatus");
const { EVENT_KIND } = await import("../constants/vocabulary");
const { AGENT_TOOL } = await import("./constants/agentTools");
const { planSteps } = await import("../runtime/planStepStore");
const { templateStore } = await import("../templates/templateStore");
const { db } = await import("../../db/app");
// wires the declarative resolver — the def-key resolution authorize() rides
await import("../nodes/declarativeBootstrap");
const { registerFakeGitHost } = await import("@/tests/helpers/fakeGitHost");

let git: import("@/tests/helpers/fakeGitHost").FakeGitHost;

beforeAll(async () => {
  await resetTestDatabase();
  git = registerFakeGitHost();
});

const now = () => new Date().toISOString();

interface Seed {
  flowId: string;
  nodeId: string;
  nodeKey: string;
  apiToken: string;
}

/** A node claimed through the real authority + its startup run row. */
const seedAttempt = async (index: number, type: string): Promise<Seed> => {
  const flowId = `flw_at_${index}`;
  const nodeId = `node_at_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_at_${index}`, "generic", `TST-${index}`, "agent tools", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId, `task_at_${index}`, `tools ${index}`, "active", "cloud", now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, type, type, NODE_STATUS.PENDING, now(), now(),
  );
  const claim = await engineParts.transitions.claim(flowId, type, "runFromPending");
  await engineParts.nodeSupport.registerStartupRun(flowId, nodeId, claim.attemptId, claim.apiToken);
  return { flowId, nodeId, nodeKey: type, apiToken: claim.apiToken };
};

const dispatch = (seed: Seed, tool: string, payload: Record<string, unknown> = {}) =>
  engineParts.agentTools.dispatch({
    flowId: seed.flowId,
    nodeKey: seed.nodeKey,
    token: seed.apiToken,
    call: { tool, ...payload } as never,
  });

describe("agentToolService", () => {
  it("authenticates the per-attempt token against the run row and dispatches", async () => {
    const seed = await seedAttempt(1, NODE_KEYS.BUILD);
    const result = await dispatch(seed, AGENT_TOOL.READ_FLOW_STATE) as { nodes: { key: string; status: string }[] };
    expect(result.nodes).toEqual([{ key: NODE_KEYS.BUILD, status: NODE_STATUS.RUNNING }]);
  });

  it("rejects a wrong token and a token whose run row lost its credential with 401", async () => {
    const seed = await seedAttempt(2, NODE_KEYS.BUILD);
    await expect(AGENT_TOKEN_MISMATCH_DISPATCH(seed)).rejects.toMatchObject({ status: 401 });
    // the run row's token cleared (closed run) — nothing left to authenticate
    await testRun(`UPDATE runs SET api_token=NULL WHERE node_id=$1`, seed.nodeId);
    await expect(dispatch(seed, AGENT_TOOL.READ_FLOW_STATE)).rejects.toMatchObject({ status: 401 });
  });

  it("expires the token once the attempt loses the node (terminal transition)", async () => {
    const seed = await seedAttempt(3, NODE_KEYS.BUILD);
    await engineParts.transitions.apply(seed.flowId, seed.nodeKey, "cancel");
    await expect(dispatch(seed, AGENT_TOOL.READ_FLOW_STATE)).rejects.toMatchObject({ status: 401 });
  });

  it("gates tools by the node kind's agentTools() allowlist", async () => {
    const plan = await seedAttempt(4, NODE_KEYS.PLAN);
    // the checklist-claim tool is build/step-build only
    await expect(dispatch(plan, AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS, { stepIds: ["s1"] }))
      .rejects.toMatchObject({ status: 403 });
    // read + report_failure are the agent-run tier's defaults
    await expect(dispatch(plan, AGENT_TOOL.READ_FLOW_STATE)).resolves.toBeTruthy();
  });

  it("claims checklist progress by meta id, idempotently, with an event; unknown ids fail loudly", async () => {
    const seed = await seedAttempt(5, NODE_KEYS.BUILD);
    // the plan artifact the steps hang off (plan_steps.artifact_id FK)
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      `art_steps_5`, seed.nodeId, seed.flowId, "plan", 1, "# Plan", null, "draft", now(),
    );
    await planSteps.syncFromPlan(seed.flowId, "art_steps_5", [
      { id: "s1", title: "Step one" },
      { id: "s2", title: "Step two" },
    ]);
    const first = await dispatch(seed, AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS, { stepIds: ["s1"] }) as { claimed: string[] };
    expect(first.claimed).toEqual(["s1"]);
    // idempotent per step id — a repeat is not an error
    const second = await dispatch(seed, AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS, { stepIds: ["s1"] }) as { claimed: string[]; alreadyDone: string[] };
    expect(second.claimed).toEqual([]);
    expect(second.alreadyDone).toEqual(["s1"]);
    // unknown ids fail loudly — a hallucinated id never silently vanishes
    await expect(dispatch(seed, AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS, { stepIds: ["nope"] }))
      .rejects.toMatchObject({ status: 400 });
    const events = await testAll<{ type: string }>(`SELECT type FROM events WHERE flow_id=$1`, seed.flowId);
    expect(events.some((e) => e.type === EVENT_KIND.LIFECYCLE)).toBe(true);
  });

  it("report_failure fails the node via the authority with a typed event", async () => {
    const seed = await seedAttempt(6, NODE_KEYS.BUILD);
    await dispatch(seed, AGENT_TOOL.REPORT_FAILURE, { reason: "tests fail", detail: "3 failing" });
    expect(await engineParts.nodeSupport.nodeStatus(seed.nodeId)).toBe(NODE_STATUS.FAILED);
    const events = await testAll<{ type: string; data: Record<string, unknown> }>(
      `SELECT type, data FROM events WHERE flow_id=$1 AND type=$2`, seed.flowId, EVENT_KIND.AGENT_REPORTED_FAILURE);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ reason: "tests fail", detail: "3 failing" });
    // the node is terminal now — the token is dead, a repeat cannot even auth
    await expect(dispatch(seed, AGENT_TOOL.REPORT_FAILURE, { reason: "again" }))
      .rejects.toMatchObject({ status: 401 });
  });

  it("report_failure is bounded: a second call while the attempt still holds the node is a 409", async () => {
    const seed = await seedAttempt(7, NODE_KEYS.BUILD);
    // the durable one-per-attempt marker (the event trail) already recorded
    await testRun(
      `INSERT INTO events (id, flow_id, node_id, type, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      `ev_rf_${seed.nodeId}`, seed.flowId, seed.nodeId, EVENT_KIND.AGENT_REPORTED_FAILURE,
      "agent reported failure: earlier", JSON.stringify({ attemptId: (await testGet<{ attemptId: string }>(`SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`, seed.nodeId))?.attemptId }), now(),
    );
    await expect(dispatch(seed, AGENT_TOOL.REPORT_FAILURE, { reason: "again" }))
      .rejects.toMatchObject({ status: 409 });
    expect(await engineParts.nodeSupport.nodeStatus(seed.nodeId)).toBe(NODE_STATUS.RUNNING);
  });

  // ── task 13: `create_change_request` tool + per-node `agent_tools` ────────

  /** A declarative agent node claimed through the real authority — the same
   *  seedAttempt discipline, with the node's def key pointing at a seeded
   *  `node_templates` row whose config carries the declared `agent_tools`. */
  const seedAgentNodeAttempt = async (index: number, agentTools: string[] | null): Promise<Seed> => {
    const template = await templateStore.createNodeTemplate({
      key: `agent_tools_fixture_${index}`,
      name: `Agent tools fixture ${index}`,
      kind: "agent",
      config: {
        mode: "plan",
        prompt: "do the work",
        output: "markdown",
        ...(agentTools ? { agent_tools: agentTools } : {}),
      },
    });
    const flowId = `flw_at_${index}`;
    const nodeId = `node_at_${index}`;
    const nodeKey = "changelog";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      `task_at_${index}`, "generic", `TST-${index}`, "agent tools", "open", "story", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      flowId, `task_at_${index}`, `tools ${index}`, "active", "cloud", now(), now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      nodeId, flowId, nodeKey, template.id, NODE_STATUS.PENDING, now(), now(),
    );
    const claim = await engineParts.transitions.claim(flowId, nodeKey, "runFromPending");
    await engineParts.nodeSupport.registerStartupRun(flowId, nodeId, claim.attemptId, claim.apiToken);
    return { flowId, nodeId, nodeKey, apiToken: claim.apiToken };
  };

  /** A branch fact the verb targets (fixture setup; the verb test's insert). */
  const seedBranchFact = async (flowId: string, name: string): Promise<void> => {
    await testRun(
      `INSERT INTO branches (id, flow_id, name, git_branch, title, status, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$3,'building',$4,$4)`,
      db.uid("br_"), flowId, name, now(),
    );
  };

  const mrCreateJobs = (flowId: string) =>
    testAll<{ status: string }>(`SELECT status::text AS status FROM jobs WHERE flow_id=$1 AND kind='mr_create'`, flowId);

  it("create_change_request runs the SAME verb under the attempt claim for a node that declares it", async () => {
    const seed = await seedAgentNodeAttempt(9, ["read_flow_state", "create_change_request"]);
    await seedBranchFact(seed.flowId, "feat/changelog");

    const result = await dispatch(seed, AGENT_TOOL.CREATE_CHANGE_REQUEST) as { requested: boolean; created: boolean };
    expect(result).toEqual({ requested: true, created: true });

    // the engine — not agent prose — established the change_request fact: the
    // host saw exactly one create, the branch row carries it, the journal job
    // completed in the persist transaction
    const creates = git.calls.filter((c) => c.kind === "createChangeRequest");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.input.sourceBranch).toBe("feat/changelog");
    const branch = await testGet<{ mr_iid: number | null; status: string }>(
      `SELECT mr_iid, status::text AS status FROM branches WHERE flow_id=$1 AND name='feat/changelog'`,
      seed.flowId,
    );
    expect(branch?.mr_iid).not.toBeNull();
    expect(branch?.status).toBe("approved");
    const jobs = await mrCreateJobs(seed.flowId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("done");
  });

  it("create_change_request is denied with the typed authorization failure for a node that does not declare it", async () => {
    const seed = await seedAgentNodeAttempt(10, null); // the schema default: read + report_failure only
    const callsBefore = git.calls.length;

    await expect(dispatch(seed, AGENT_TOOL.CREATE_CHANGE_REQUEST)).rejects.toMatchObject({ status: 403 });
    // nothing ran: no host call, no journal job — the deny precedes any effect
    expect(git.calls.length).toBe(callsBefore);
    expect(await mrCreateJobs(seed.flowId)).toHaveLength(0);
    // the default preserves today's behavior exactly
    await expect(dispatch(seed, AGENT_TOOL.READ_FLOW_STATE)).resolves.toBeTruthy();
    await expect(dispatch(seed, AGENT_TOOL.REPORT_FAILURE, { reason: "tests fail" })).resolves.toBeTruthy();
  });
});

/** A dispatch with a token that is not the attempt's. */
const AGENT_TOKEN_MISMATCH_DISPATCH = (seed: Seed): Promise<unknown> =>
  engineParts.agentTools.dispatch({
    flowId: seed.flowId,
    nodeKey: seed.nodeKey,
    token: "deadbeef",
    call: { tool: AGENT_TOOL.READ_FLOW_STATE } as never,
  });
