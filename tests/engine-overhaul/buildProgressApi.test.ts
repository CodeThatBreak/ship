/**
 * Step 08 e2e: the build checklist's authoritative progress path — the
 * running build agent claims plan steps through the agent-tools API while
 * its run is in flight (the capability token rides the run row), the
 * fence-absent result still passes, the token dies with the run, and
 * `report_failure` fails the node mid-run with a retryable failure.
 *
 * The plan→build edge auto-starts the build in the background on approval,
 * so each case queues the build outcome and monkey-patches the fake port's
 * `stream` BEFORE `approvePlan`: the interleave dispatch runs while the
 * build run is still streaming, then the real stream proceeds (restored in
 * `finally` so cases stay independent). Runs against the isolated
 * dockerized Postgres test database (AGENTS.md §1 — never a demo/real DB).
 */
import { testAll, testGet } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost } from "../helpers/fakeGitHost";
import type { AgentStreamOutcome } from "@/lib/engine/ports/agentPort";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");
const { engineParts } = await import("@/lib/composition/container");
const { EVENT_KIND } = await import("@/lib/engine/constants/vocabulary");
const { AGENT_TOOL } = await import("@/lib/engine/agentTools/constants/agentTools");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
// the fake git host is registered for bootstrap parity with the SDLC e2e suite
registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const PLAN_TURN = JSON.stringify({
  reply: "Planned in two steps.",
  plan: {
    markdown: "# Plan\n\n1. First\n2. Second",
    steps: [
      { id: "s1", title: "First", detail: "d1", files: ["a.ts"] },
      { id: "s2", title: "Second", detail: "d2", files: ["b.ts"] },
    ],
  },
});

/** The stream-boundary interleave: the FIRST stream call runs `interleave`. */
const interleaveDuringStream = (interleave: () => Promise<void>): (() => Promise<AgentStreamOutcome>) => {
  const realStream = agent.stream.bind(agent);
  let armed = true;
  agent.stream = async (): Promise<AgentStreamOutcome> => {
    if (armed) {
      armed = false;
      await interleave();
    }
    return realStream();
  };
  return realStream;
};

/** The capability token the in-flight run row carries (aliased snake_case). */
const runningApiToken = async (flowId: string, nodeKey: string): Promise<string> => {
  const nodeRow = await testGet<{ id: string }>(
    `SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey,
  );
  if (!nodeRow) throw new Error(`no node row for ${flowId}/${nodeKey}`);
  const run = await testGet<{ apiToken: string | null }>(
    `SELECT api_token AS "apiToken" FROM runs WHERE node_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1`,
    nodeRow.id,
  );
  if (!run?.apiToken) throw new Error(`no running run row with an api token for ${flowId}/${nodeKey}`);
  return run.apiToken;
};

/** plan chat turn → awaiting_approval (the caller approves + scripts build). */
const driveToApprovedPlan = async (flowId: string): Promise<void> => {
  agent.pushRun({ status: "finished", result: PLAN_TURN });
  agent.pushRun({ status: "finished", result: PLAN_TURN });
  flowEngine.chats.sendChat(flowId, NODE_KEYS.PLAN, "plan this task");
  await until(
    async () => (await harness.nodeStatus(flowId, NODE_KEYS.PLAN)) === "awaiting_approval",
    "the plan turn to reach awaiting_approval",
  );
  agent.drainQueue();
};

const planStepStatuses = async (flowId: string): Promise<string[]> => {
  const rows = await testAll<{ status: string }>(
    `SELECT status FROM plan_steps WHERE flow_id=$1 ORDER BY position, created_at`, flowId,
  );
  return rows.map((r) => r.status);
};

// state handed from the claims case to the token-death case (same flow)
let claimsFlowId: string | null = null;
let claimsToken: string | null = null;

describe("build progress via the agent-tools API (fake ports)", () => {
  it("API claims mark the steps done + emit the event; a fence-absent result passes", async () => {
    const flowId = await harness.seedSdlcFlow();
    await driveToApprovedPlan(flowId);
    const realStream = interleaveDuringStream(async () => {
      const token = await runningApiToken(flowId, NODE_KEYS.BUILD);
      claimsFlowId = flowId;
      claimsToken = token;
      await engineParts.agentTools.dispatch({
        flowId, nodeKey: NODE_KEYS.BUILD, token,
        call: { tool: AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS, stepIds: ["s1", "s2"] },
      });
    });
    try {
      // no build-progress fence in the result — the API claims carry it
      agent.pushRun({ status: "finished", result: "built and pushed" });
      await flowEngine.approvals.approvePlan(flowId);
      await until(
        async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "awaiting_approval",
        "the build to land awaiting_approval",
        10_000,
      );
      expect(await planStepStatuses(flowId)).toEqual(["done", "done"]);
      const lifecycle = await harness.events(flowId, { nodeKey: NODE_KEYS.BUILD, type: EVENT_KIND.LIFECYCLE });
      expect(lifecycle.some((e) => e.message.includes("progress API"))).toBe(true);
    } finally {
      agent.stream = realStream;
    }
  });

  it("the token is dead once the run closed (401 after awaiting_approval)", async () => {
    if (claimsFlowId == null || claimsToken == null) throw new Error("the claims case did not capture a flow/token");
    await expect(engineParts.agentTools.dispatch({
      flowId: claimsFlowId, nodeKey: NODE_KEYS.BUILD, token: claimsToken,
      call: { tool: AGENT_TOOL.READ_FLOW_STATE },
    })).rejects.toMatchObject({ status: 401 });
  });

  it("neither API claims nor a fence with pending steps fails the build loudly", async () => {
    const flowId = await harness.seedSdlcFlow();
    await driveToApprovedPlan(flowId);
    agent.pushRun({ status: "finished", result: "built and pushed" });
    await flowEngine.approvals.approvePlan(flowId);
    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "failed",
      "the build to fail loudly on the missing progress report",
      10_000,
    );
    const violations = await harness.events(flowId, {
      nodeKey: NODE_KEYS.BUILD, type: EVENT_KIND.OUTPUT_CONTRACT_VIOLATION,
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("report_failure fails the node mid-run and a retry runs it again", { timeout: 30_000 }, async () => {
    const flowId = await harness.seedSdlcFlow();
    await driveToApprovedPlan(flowId);
    const realStream = interleaveDuringStream(async () => {
      const token = await runningApiToken(flowId, NODE_KEYS.BUILD);
      await engineParts.agentTools.dispatch({
        flowId, nodeKey: NODE_KEYS.BUILD, token,
        call: { tool: AGENT_TOOL.REPORT_FAILURE, reason: "tests fail on the retried path", detail: "3 failing" },
      });
    });
    try {
      agent.pushRun({ status: "finished", result: "built and pushed" });
      await flowEngine.approvals.approvePlan(flowId);
      await until(
        async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "failed",
        "the build to fail via report_failure",
        10_000,
      );
      const reported = await testAll<{ type: string; data: Record<string, unknown> }>(
        `SELECT type, data FROM events WHERE flow_id=$1 AND type=$2`,
        flowId, EVENT_KIND.AGENT_REPORTED_FAILURE,
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]?.data).toMatchObject({ reason: "tests fail on the retried path" });

      // the still-in-flight run settles through the late-write guard first
      await until(
        async () =>
          (await harness.events(flowId, { nodeKey: NODE_KEYS.BUILD, type: EVENT_KIND.LIFECYCLE }))
            .some((e) => e.message.includes("ignoring")),
        "the superseded build result to be ignored",
      );

      // the retry starts a fresh run — hold its stream briefly so `running`
      // is observable before the outcome lands
      const retryStream = agent.stream.bind(agent);
      agent.stream = async (): Promise<AgentStreamOutcome> => {
        await new Promise((r) => setTimeout(r, 400));
        return retryStream();
      };
      agent.drainQueue(); // the prior run's repeating outcome must not feed the retry
      agent.pushRun({
        status: "finished",
        result: 'rebuilt and pushed\n\n```json build-progress\n{"completed":["s1","s2"]}\n```',
      });
      await flowEngine.retries.retryNode(flowId, NODE_KEYS.BUILD);
      await until(
        async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "running",
        "the retried build to run",
      );
      await until(
        async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "awaiting_approval",
        "the retried build to land awaiting_approval",
        10_000,
      );
    } finally {
      agent.stream = realStream;
    }
  });
});
