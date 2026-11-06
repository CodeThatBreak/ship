/**
 * Characterization (red): a late split aggregate must NOT overwrite a node the
 * user already retried or cancelled (engine overhaul step 00; flip in step 02).
 *
 * Current bug (flowEngine.ts finishSplit, the unconditional
 * `UPDATE nodes SET status=?, output=? … WHERE flow_id=? AND node_key=?` —
 * no status precondition, contrasted with finishFanout's `AND status='running'`):
 * a split aggregate that resolves after the user retried/cancelled the node
 * clobbers the live status and re-advances the flow off stale units.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-split-overwrite-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

const harness = new FlowHarness({ db, flowEngine, templateStore });

describe("finishSplit overwrite guard", () => {
  // OVERHAUL: flip in step 02
  test.fails("a late split aggregate does not regress a node the user retried", async () => {
    const flowId = harness.seedSdlcFlow();
    const buildKey = "build";

    // the user retried the split consumer: it is claimed back into running
    harness.claimNode(flowId, buildKey, ["pending", "failed", "done"]);
    expect(harness.nodeStatus(flowId, buildKey)).toBe("running");

    // a STALE split aggregate resolves late — target: it must NOT overwrite the
    // retried node; today finishSplit has no status precondition and clobbers it
    await flowEngine.finishSplit(flowId, buildKey, {
      units: [{ key: "u1", title: "Unit", status: "done", output: {} }],
    });

    expect(harness.nodeStatus(flowId, buildKey)).toBe("running");
  });
});
