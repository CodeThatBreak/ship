/**
 * Characterization: the plan node's Retry must never be a dead end — a
 * chat-only plan node replays its recorded turn, or reverts to an actionable
 * status (engine overhaul step 00; flip in step 05, per
 * `docs/current-issue-plan.md` Issue 2).
 *
 * The F2 fix landed ahead of the overhaul (`flowEngine.retryNode` chat-first
 * branch + `resolvePlanFailedRetryStatus`), so these pin the TARGET behavior
 * GREEN — the regression guard step 05's acceptance keeps green.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-plan-retry-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { PlanInput } = await import("@/lib/engine/nodes/kinds/plan/schema");
const { PLAN_CHAT_READY_LIFECYCLE } = await import("@/lib/engine/nodes/kinds/plan/planRetryRevert");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

const planNodeRow = (flowId: string) => {
  const row = db.get<{ id: string }>(
    `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`,
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
    const flowId = harness.seedSdlcFlow();
    const plan = planNodeRow(flowId);
    // a plan version exists, and the failed node recorded the refine turn
    db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES (?,?,?,?,?,?,?,'draft',?)`,
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
    db.run(
      `UPDATE nodes SET status='failed', input=?, updated_at=? WHERE id=?`,
      JSON.stringify(recorded), db.now(), plan.id,
    );
    agent.pushRun({ status: "finished", result: PLAN_TURN });

    flowEngine.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      () => harness.nodeStatus(flowId, NODE_KEYS.PLAN) === "awaiting_approval",
      "the plan retry to land awaiting_approval",
    );
    expect(agent.prompts().some((p) => p.includes("move step 2 below step 1"))).toBe(true);
  }, 15_000);

  // OVERHAUL: flip in step 05 (green — F2 landed)
  test("retry with no recorded turn reverts to an actionable status with the chat-ready event", () => {
    const flowId = harness.seedSdlcFlow();
    const plan = planNodeRow(flowId);
    db.run(
      `UPDATE nodes SET status='failed', input=?, updated_at=? WHERE id=?`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(), plan.id,
    );

    flowEngine.retryNode(flowId, NODE_KEYS.PLAN);

    expect(harness.nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("pending");
    const messages = harness.events(flowId, { nodeKey: NODE_KEYS.PLAN, type: "lifecycle" })
      .map((e) => e.message);
    expect(messages).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });
});
