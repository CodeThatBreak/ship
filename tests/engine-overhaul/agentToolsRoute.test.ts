/**
 * Step 08 (Invariant 10): the agent-tools REST route — the thin adapter over
 * `AgentToolService.dispatch`. Calls the POST handler directly (no HTTP
 * server): bearer parsing, the discriminated-union body validation, the
 * typed-error → HTTP mapping, and the capability gate.
 *
 * Seeding mirrors the co-located service test (raw INSERTs, a claim through
 * the real authority, `registerStartupRun`, dispatch through
 * `engineParts.agentTools`). Runs against the isolated dockerized Postgres
 * test database (AGENTS.md §1 — never a demo/real database).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";

assignTestDatabase();

const { engineParts } = await import("@/lib/composition/container");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");
const { NODE_STATUS } = await import("@/lib/engine/constants/nodeStatus");
const { AGENT_TOOL } = await import("@/lib/engine/agentTools/constants/agentTools");
const { POST } = await import("@/app/api/flows/[id]/nodes/[nodeKey]/agent-tools/route");

beforeAll(resetTestDatabase);

const now = (): string => new Date().toISOString();

interface Seed {
  flowId: string;
  nodeId: string;
  nodeKey: string;
  apiToken: string;
}

/** A node claimed through the real authority + its startup run row. */
const seedAttempt = async (index: number, type: string): Promise<Seed> => {
  const flowId = `flw_rt_${index}`;
  const nodeId = `node_rt_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_rt_${index}`, "generic", `TRT-${index}`, "agent tools route", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId, `task_rt_${index}`, `tools route ${index}`, "active", "cloud", now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, type, type, NODE_STATUS.PENDING, now(), now(),
  );
  const claim = await engineParts.transitions.claim(flowId, type, "runFromPending");
  await engineParts.nodeSupport.registerStartupRun(flowId, nodeId, claim.attemptId, claim.apiToken);
  return { flowId, nodeId, nodeKey: type, apiToken: claim.apiToken };
};

/** Invoke the route handler directly — params come as a Promise in Next 15. */
const callRoute = (seed: Seed, token: string | null, body: unknown): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/flows/${seed.flowId}/nodes/${seed.nodeKey}/agent-tools`, {
      method: "POST",
      headers: {
        ...(token == null ? {} : { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: seed.flowId, nodeKey: seed.nodeKey }) },
  );

const jsonBody = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

describe("agent-tools route", () => {
  it("dispatches a valid read_flow_state call — 200 with { ok, result.nodes }", async () => {
    const seed = await seedAttempt(1, NODE_KEYS.BUILD);
    const res = await callRoute(seed, seed.apiToken, { tool: AGENT_TOOL.READ_FLOW_STATE });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    const result = body.result as { nodes: { key: string; status: string }[] };
    expect(result.nodes).toEqual([{ key: NODE_KEYS.BUILD, status: NODE_STATUS.RUNNING }]);
  });

  it("rejects a missing bearer header with 401 unauthorized", async () => {
    const seed = await seedAttempt(2, NODE_KEYS.BUILD);
    const res = await callRoute(seed, null, { tool: AGENT_TOOL.READ_FLOW_STATE });
    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toMatchObject({ code: "unauthorized" });
  });

  it("rejects a wrong token with 401", async () => {
    const seed = await seedAttempt(3, NODE_KEYS.BUILD);
    const res = await callRoute(seed, "deadbeef", { tool: AGENT_TOOL.READ_FLOW_STATE });
    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toMatchObject({ code: "unauthorized" });
  });

  it("rejects claim_checklist_progress without stepIds with 400 invalid_input (union validation)", async () => {
    const seed = await seedAttempt(4, NODE_KEYS.BUILD);
    const res = await callRoute(seed, seed.apiToken, { tool: AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS });
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toMatchObject({ code: "invalid_input" });
  });

  it("rejects an unknown tool literal with 400 (discriminated union)", async () => {
    const seed = await seedAttempt(5, NODE_KEYS.BUILD);
    const res = await callRoute(seed, seed.apiToken, { tool: "does_not_exist" });
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toMatchObject({ code: "invalid_input" });
  });

  it("gates claim_checklist_progress on a plan node with 403 forbidden", async () => {
    const seed = await seedAttempt(6, NODE_KEYS.PLAN);
    const res = await callRoute(seed, seed.apiToken, {
      tool: AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS,
      stepIds: ["s1"],
    });
    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toMatchObject({ code: "forbidden" });
  });

  it("report_failure with a valid token fails the node in the database", async () => {
    const seed = await seedAttempt(7, NODE_KEYS.BUILD);
    const res = await callRoute(seed, seed.apiToken, {
      tool: AGENT_TOOL.REPORT_FAILURE,
      reason: "tests fail",
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ ok: true });
    expect(await engineParts.nodeSupport.nodeStatus(seed.nodeId)).toBe(NODE_STATUS.FAILED);
  });
});
