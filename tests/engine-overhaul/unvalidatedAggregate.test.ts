/**
 * Characterization (red): a fan-out/split aggregate that fails its output
 * contract must fail the node loudly — never publish unvalidated and advance
 * the flow (engine overhaul step 00; flip in step 04).
 *
 * Current bug (flowEngine.ts finishFanout / finishSplit): a contract failure
 * emits a "publishing it unvalidated" error event, then still writes the
 * terminal status + output and advances the outgoing edges — the downstream
 * consumes an aggregate nothing validated.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-unvalidated-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

const harness = new FlowHarness({ db, flowEngine, templateStore });

/** A split consumer (build) feeding a downstream node, so "advance" is observable. */
const splitFlowYaml = `
name: Overhaul unvalidated aggregate
trigger:
  type: manual
nodes:
  - key: build
    type: builtin/build
  - key: gate
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
edges:
  - [build, gate]
`;

const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");

describe("unvalidated fan-out/split aggregate", () => {
  // OVERHAUL: flip in step 04
  test.fails("finishSplit contract failure fails the node and does NOT advance the flow", async () => {
    const { id: templateId } = importTemplateYaml(templateStore, splitFlowYaml, {
      namePrefix: "ovh-unvalidated",
    });
    const flowId = harness.seedFlowFromTemplate(templateId);

    // the split consumer is mid-run when a malformed aggregate resolves: the
    // `units` entries violate the split contract (status out of vocabulary)
    harness.claimNode(flowId, "build", ["pending", "failed", "done"]);
    await flowEngine.finishSplit(flowId, "build", {
      units: [{ key: "u1", title: "Unit", status: 12345, output: {} }],
    });

    // target: the node is failed with a typed contract event, and the
    // downstream node is NOT started (the flow does not advance on invalid data)
    expect(harness.nodeStatus(flowId, "build")).toBe("failed");
    const contractEvents = harness.events(flowId, { nodeKey: "build" })
      .filter((e) => e.message.toLowerCase().includes("contract"));
    expect(contractEvents.length).toBeGreaterThan(0);
    expect(harness.nodeStatus(flowId, "gate")).toBe("pending");
  });
});
