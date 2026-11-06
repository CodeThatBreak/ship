/**
 * Characterization (red): the reconciler must resolve EVERY non-terminal
 * state without guessing (engine overhaul step 00; flip in step 03).
 *
 * Current gaps (flowReconciler.ts only walks `running` nodes):
 *  - `approved`-without-MR (a build whose MR never landed / was merged
 *    out-of-band) is invisible to the reconciler — it only scans
 *    `status='running'` (`flowReconciler.ts:97`), so an approved build sits
 *    forever with no revert-or-adopt.
 *  - expired `waiting` (a wait deadline in the past) is never fired by the
 *    reconciler (the in-memory waitTimers map is the only driver, lost on
 *    restart).
 *  - `awaiting_approval` with a dead upstream (its producer failed) never
 *    fails — it waits for an approval that can never meaningfully come.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-reconcile-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { reconciler } = await import("@/lib/engine/runtime/flowReconciler");

registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

describe("reconciler resolves every non-terminal state", () => {
  // OVERHAUL: flip in step 03
  test.fails("approved-without-MR ⇒ revert-or-adopt (today invisible to the reconciler)", async () => {
    const flowId = harness.seedSdlcFlow();
    // a build approved but its MR never landed: approved, no mr_iid, old stamp
    harness.setNodeForFixture(flowId, "build", "approved");
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    db.run(`UPDATE nodes SET updated_at=? WHERE flow_id=? AND node_key='build'`, stale, flowId);

    await reconciler.reconcileFlow(flowId);

    // target: the reconciler either adopts the MR (re-creates/attaches it) or
    // reverts the build to awaiting_approval with a loud event — today it
    // never looks at `approved` nodes, so nothing changes
    const status = harness.nodeStatus(flowId, "build");
    expect(status === "awaiting_approval" || status === "done" || status === "approved").toBe(true);
    const resolved = db.get<{ mr_iid: number | null }>(`SELECT mr_iid FROM flows WHERE id=?`, flowId);
    const revertedOrAdopted = status === "awaiting_approval" || resolved?.mr_iid != null;
    expect(revertedOrAdopted).toBe(true);
  }, 15_000);

  // OVERHAUL: flip in step 03
  test.fails("expired waiting ⇒ the wait fires (today only the in-memory timer drives it)", async () => {
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
    const { id: templateId } = importTemplateYaml(templateStore, timerYaml, {
      namePrefix: "ovh-reconcile-wait",
    });
    const flowId = harness.seedFlowFromTemplate(templateId);
    // the gate is waiting with a deadline already in the past (a restart lost
    // the in-memory timer) — the reconciler must fire it
    harness.setNodeForFixture(flowId, "gate", "waiting");
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    db.run(`UPDATE nodes SET updated_at=? WHERE flow_id=? AND node_key='gate'`, stale, flowId);

    await reconciler.reconcileFlow(flowId);

    // target: an expired wait is fired by the reconciler — today it only
    // reconciles `running` nodes, so a waiting node is never resumed
    expect(harness.nodeStatus(flowId, "gate")).not.toBe("waiting");
  }, 15_000);

  // OVERHAUL: flip in step 03
  test.fails("awaiting_approval with a dead upstream ⇒ failed (today waits forever)", async () => {
    const flowId = harness.seedSdlcFlow();
    // build awaiting approval, but its upstream plan failed (dead upstream)
    harness.setNodeForFixture(flowId, "plan", "failed");
    harness.setNodeForFixture(flowId, "build", "awaiting_approval");
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    db.run(`UPDATE nodes SET updated_at=? WHERE flow_id=? AND node_key='build'`, stale, flowId);

    await reconciler.reconcileFlow(flowId);

    // target: a node awaiting approval whose upstream is dead is failed with a
    // typed event — today the reconciler ignores non-running states
    expect(harness.nodeStatus(flowId, "build")).toBe("failed");
  }, 15_000);
});
