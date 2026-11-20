/**
 * Characterization: the plan node's Retry must never be a dead end — a
 * chat-only plan node replays its recorded turn, or reverts to an actionable
 * status (engine overhaul step 00; flip in step 05, per
 * `docs/current-issue-plan.md` Issue 2).
 *
 * The F2 fix landed ahead of the overhaul (`flowEngine.retries.retryNode` chat-first
 * branch + `resolvePlanFailedRetryStatus`), so these pin the TARGET behavior
 * GREEN — the regression guard step 05's acceptance keeps green.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { PlanInput } = await import("@/lib/engine/nodes/kinds/plan/schema");
const { PLAN_CHAT_READY_LIFECYCLE } = await import("@/lib/engine/nodes/kinds/plan/planRetryRevert");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const planNodeRow = async (flowId: string) => {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`,
    flowId, NODE_KEYS.PLAN,
  );
  if (!row) throw new Error(`no plan node on ${flowId}`);
  return row;
};

const PLAN_TURN = JSON.stringify({
  reply: "Moved step 2 below step 1.",
  plan: {
    markdown: "# Plan (refined)",
    steps: [
      { id: "s1", title: "First", detail: "d", files: ["a.ts"] },
      { id: "s2", title: "Second", detail: "d", files: ["b.ts"] },
    ],
  },
});

describe("plan node Retry is never a dead end", () => {
  // OVERHAUL: flip in step 05 (green — the F2 fix landed ahead of the overhaul)
  test("retry replays a recorded turn via the chat refiner and lands awaiting_approval", async () => {
    const flowId = await harness.seedSdlcFlow();
    const plan = await planNodeRow(flowId);
    // a plan version exists, and the failed node recorded the refine turn
    await db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
      `art_plan_${flowId}`, plan.id, flowId, "plan", 1, "# Plan",
      JSON.stringify({ steps: [], branches: [] }), db.now(),
    );
    const recorded = PlanInput.parse({
      turnUserMessage: "move step 2 below step 1",
      previousStatus: "awaiting_approval",
      planTurnKind: "whole",
      planThread: null,
      model: null,
    });
    await db.run(
      `UPDATE nodes SET status='failed', input=$1, updated_at=$2 WHERE id=$3`,
      JSON.stringify(recorded), db.now(), plan.id,
    );
    agent.pushRun({ status: "finished", result: PLAN_TURN });

    flowEngine.retries.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.PLAN)) === "awaiting_approval",
      "the plan retry to land awaiting_approval",
    );
    expect(agent.prompts().some((p) => p.includes("move step 2 below step 1"))).toBe(true);
  }, 15_000);

  // OVERHAUL: flip in step 05 (green — F2 landed)
  test("retry with no recorded turn reverts to an actionable status with the chat-ready event", async () => {
    const flowId = await harness.seedSdlcFlow();
    const plan = await planNodeRow(flowId);
    await db.run(
      `UPDATE nodes SET status='failed', input=$1, updated_at=$2 WHERE id=$3`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(), plan.id,
    );

    flowEngine.retries.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.PLAN)) === "pending",
      "plan retry to revert to pending",
    );
    expect(await harness.nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("pending");
    const messages = (await harness.events(flowId, { nodeKey: NODE_KEYS.PLAN, type: "lifecycle" }))
      .map((e) => e.message);
    expect(messages).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });
});
