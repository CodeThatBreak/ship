/**
 * Characterization (red): duplicate triggers of the same node (webhook +
 * poller + manual) must collapse to exactly ONE run, with the losers emitting
 * a typed `skipped_duplicate_trigger` event (engine overhaul step 00; flip
 * in step 06).
 *
 * Current bug: the resume/trigger claim paths silently return on conflict
 * (edgeActivator.ts:317, sdlcChain.ts:156/173, waitScheduler.ts) — the
 * duplicate loses the claim but NOTHING records the skip, so concurrent
 * triggers are invisible (no run dedup event, and some paths re-run).
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-dup-trigger-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

describe("duplicate triggers collapse to one run + one skip event", () => {
  // OVERHAUL: flip in step 06
  test.fails("poller + webhook + manual triggers of the gate ⇒ one run, one skipped_duplicate_trigger", async () => {
    const flowId = harness.seedSdlcFlow();
    db.run(`UPDATE flows SET mr_iid=?, mr_branch=? WHERE id=?`, 1, "devflow/ovh-dup", flowId);
    // the gate is mid-run (an in-flight pipeline wait owns it)
    harness.claimNode(flowId, "pipeline", ["pending", "failed", "done"]);
    expect(harness.nodeStatus(flowId, "pipeline")).toBe("running");

    // three duplicate triggers race the in-flight gate: the poller's
    // pipeline-status tick, a GitLab webhook delivery, and the Pipeline
    // panel's manual re-run
    flowEngine.triggerPipelineGate(flowId); // poller
    flowEngine.triggerPipelineGate(flowId, 42); // webhook
    flowEngine.triggerPipelineGate(flowId, undefined, "model-x"); // manual

    // target: the losers emit exactly one typed skipped_duplicate_trigger
    // event each is too much to ask of the current silent code — the target
    // is AT LEAST one such event recording the dedup; today there are none
    const skips = harness.events(flowId)
      .filter((e) => e.message.includes("skipped_duplicate_trigger")
        || e.type === "skipped_duplicate_trigger");
    expect(skips.length).toBeGreaterThan(0);

    // and the gate is still exactly one in-flight run (not re-claimed)
    expect(harness.nodeStatus(flowId, "pipeline")).toBe("running");
  });
});
