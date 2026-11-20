/**
 * Characterization (flipped green in step 02): a late split aggregate must
 * NOT overwrite a node the user already retried — the aggregate publish is
 * attempt-fenced (the split manager captures the consumer's attempt token at
 * expand time), so a stale aggregate loses to the fresh claim even though the
 * node is `running` again.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { expectTransitionsDeclared } from "../helpers/transitionLogAssert";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { engineParts } = await import("@/lib/composition/container");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
// the split aggregate publish moved to the SplitJoin (step 07 decomposition);
// the facade composes it (private member — test seam)
const { splitManager } = await import("@/lib/engine/runtime/split/splitManager");
type SplitJoinClass = InstanceType<(typeof import("@/lib/engine/runtime/split/splitJoin"))["SplitJoin"]>;
const splitJoin = (splitManager as unknown as { join: SplitJoinClass }).join;

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

describe("finishSplit overwrite guard", () => {
  test("a late split aggregate does not regress a node the user retried", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = "build";

    // the split consumer's ORIGINAL run: claimed, and the split manager
    // captured this attempt token for its join's aggregate publish
    const original = await engineParts.transitions.claim(flowId, buildKey, "runFromPending");
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("running");

    // the user retried the consumer: cancel → failed, then a fresh claim
    // stamps a NEW attempt (the split children of the original run are still
    // resolving in the background)
    await flowEngine.cancelNode(flowId, buildKey);
    const retried = await engineParts.transitions.claim(flowId, buildKey, "retry");
    expect(retried.attemptId).not.toBe(original.attemptId);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("running");

    // a STALE aggregate resolves late — carrying the ORIGINAL run's attempt
    // (exactly what the split manager's checkJoin passes): it must NOT
    // overwrite the retried node's live state
    await splitJoin.finishSplit(flowId, buildKey, {
      units: [{ key: "u1", title: "Unit", status: "done", output: {} }],
    }, original.attemptId);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("running");

    // the CURRENT attempt's aggregate still publishes through the declared
    // splitOutcome transition
    await splitJoin.finishSplit(flowId, buildKey, {
      units: [{ key: "u1", title: "Unit", status: "done", output: {} }],
    }, retried.attemptId);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("done");

    // step-02 task 6: the transitions this test drove resolve against the
    // declared table (the in-memory log assert)
    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });
});
