/**
 * Reconciler v2 (green — engine overhaul step 03): the reconciler resolves
 * EVERY non-terminal state without guessing:
 *  - `approved`-without-MR (a build whose MR never landed) → revert to
 *    `awaiting_approval` with a loud event
 *  - expired `waiting` (a `wait_until` in the past) → the wait fires through
 *    the durable WaitStore
 *  - `awaiting_approval` with a dead upstream → `failed` with a typed event
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { Reconciler } = await import("@/lib/engine/runtime/reconcile/reconciler");

registerFakeGitHost();
const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });
const reconciler = new Reconciler();

beforeAll(resetTestDatabase);

describe("reconciler resolves every non-terminal state", () => {
  // OVERHAUL: flipped green in step 03 (ApprovedHandler → mrHandback revert)
  test("approved-without-MR ⇒ revert-or-adopt", async () => {
    const flowId = await harness.seedSdlcFlow();
    // a build approved but its MR never landed: approved, no mr_iid
    await harness.setNodeForFixture(flowId, "build", "approved");

    await reconciler.reconcileFlow(flowId);

    // the reconciler reverts the build to awaiting_approval with a loud
    // event (adopt/recreate lands with the step-07 effect layer)
    const status = await harness.nodeStatus(flowId, "build");
    expect(status === "awaiting_approval" || status === "done" || status === "approved").toBe(true);
    const resolved = await db.get<{ mr_iid: number | null }>(`SELECT mr_iid FROM flows WHERE id=$1`, flowId);
    const revertedOrAdopted = status === "awaiting_approval" || resolved?.mr_iid != null;
    expect(revertedOrAdopted).toBe(true);
    const event = await db.get<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='error' AND message LIKE '%no MR exists%'`,
      flowId);
    expect(event?.message).toContain("reverted to awaiting approval");
  }, 15_000);

  // OVERHAUL: flipped green in step 03 (WaitingHandler → durable wait fire)
  test("expired waiting ⇒ the wait fires", async () => {
    const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");
    const timerYaml = `
name: Overhaul reconcile wait
trigger:
  type: manual
nodes:
  - key: gate
    type: agent
    trigger:
      type: auto
      wait_for: timer
      minutes: 0
    config:
      mode: plan
      output: markdown
      prompt: "Ack."
edges: []
`;
    const { id: templateId } = await importTemplateYaml(templateStore, timerYaml, {
      namePrefix: "ovh-reconcile-wait",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);
    // the gate is waiting with a deadline already in the past (the process
    // that armed it is gone) — the reconciler must fire it
    await harness.setNodeForFixture(flowId, "gate", "waiting");
    await db.run(
      `UPDATE nodes SET wait_until = now() - interval '10 minutes' WHERE flow_id=$1 AND node_key='gate'`,
      flowId);
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "acknowledged." });

    await reconciler.reconcileFlow(flowId);

    // the fired wait claims the node out of `waiting` (the stage then runs to
    // a terminal in the background)
    await until(
      async () => (await harness.nodeStatus(flowId, "gate")) !== "waiting",
      "the expired wait to fire",
    );
    expect(await harness.nodeStatus(flowId, "gate")).not.toBe("waiting");
  }, 15_000);

  // OVERHAUL: flipped green in step 03 (AwaitingApprovalHandler → dead upstream)
  test("awaiting_approval with a dead upstream ⇒ failed", async () => {
    const flowId = await harness.seedSdlcFlow();
    // build awaiting approval, but its upstream plan failed (dead upstream)
    await harness.setNodeForFixture(flowId, "plan", "failed");
    await harness.setNodeForFixture(flowId, "build", "awaiting_approval");

    await reconciler.reconcileFlow(flowId);

    // a node awaiting approval whose upstream is dead fails with a typed event
    expect(await harness.nodeStatus(flowId, "build")).toBe("failed");
    const event = await db.get<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='error' AND message LIKE '%upstream plan failed%'`,
      flowId);
    expect(event?.message).toContain("upstream plan failed");
  }, 15_000);
});
