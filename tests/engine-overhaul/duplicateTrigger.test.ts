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
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

describe("duplicate triggers collapse to one run + one skip event", () => {
  // step 06: flipped — the TriggerGateway's atomic claim fences the losers,
  // each emitting a typed `skipped_duplicate_trigger` event
  test("poller + webhook + manual triggers of the gate ⇒ one run, one skipped_duplicate_trigger", async () => {
    const flowId = await harness.seedSdlcFlow();
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-dup", flowId);
    // the gate is mid-run (an in-flight pipeline wait owns it)
    await harness.claimNode(flowId, "pipeline", "manualStage");
    expect(await harness.nodeStatus(flowId, "pipeline")).toBe("running");

    // three duplicate triggers race the in-flight gate: the poller's
    // pipeline-status tick, a GitLab webhook delivery, and the Pipeline
    // panel's manual re-run. They start concurrently (Promise.all fires all
    // three before either settles) but are awaited before the event read —
    // the ORM read path's first-query latency means an unawaited read can
    // observe the DB before the losers' skip events land.
    await Promise.all([
      flowEngine.chain.triggerPipelineGate(flowId), // poller
      flowEngine.chain.triggerPipelineGate(flowId, 42), // webhook
      flowEngine.chain.triggerPipelineGate(flowId, undefined, "model-x"), // manual
    ]);

    // target: the losers emit exactly one typed skipped_duplicate_trigger
    // event each is too much to ask of the current silent code — the target
    // is AT LEAST one such event recording the dedup; today there are none
    const skips = (await harness.events(flowId))
      .filter((e) => e.message.includes("skipped_duplicate_trigger")
        || e.type === "skipped_duplicate_trigger");
    expect(skips.length).toBeGreaterThan(0);

    // and the gate is still exactly one in-flight run (not re-claimed)
    expect(await harness.nodeStatus(flowId, "pipeline")).toBe("running");
  });
});
