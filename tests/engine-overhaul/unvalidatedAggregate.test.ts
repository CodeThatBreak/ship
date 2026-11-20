/**
 * Flip (green, step 04): a fan-out/split aggregate that fails its output
 * contract fails the node loudly — never published unvalidated, the flow does
 * not advance (engine overhaul step 00 red marker → step 04 implementation).
 *
 * Was (flowEngine.ts finishFanout / finishSplit): a contract failure emitted
 * a "publishing it unvalidated" error event, then still wrote the terminal
 * status + output and advanced the outgoing edges — the downstream consumed
 * an aggregate nothing validated. Now `publishAggregate` validates at the
 * authority's contract seam; the runtime managers map the refusal to a typed
 * `output_contract_violation` event + the failed terminal, no advance.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
// the split aggregate publish moved to the SplitJoin (step 07 decomposition);
// the facade composes it (private member — test seam)
const { splitManager } = await import("@/lib/engine/runtime/split/splitManager");
type SplitJoinClass = InstanceType<(typeof import("@/lib/engine/runtime/split/splitJoin"))["SplitJoin"]>;
const splitJoin = (splitManager as unknown as { join: SplitJoinClass }).join;

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

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
  // flipped green in step 04: publishAggregate validates at the contract seam
  test("finishSplit contract failure fails the node and does NOT advance the flow", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, splitFlowYaml, {
      namePrefix: "ovh-unvalidated",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);

    // the split consumer is mid-run when a malformed aggregate resolves: the
    // `units` entries violate the split contract (status out of vocabulary)
    await harness.claimNode(flowId, "build", "manualStage");
    await splitJoin.finishSplit(flowId, "build", {
      units: [{ key: "u1", title: "Unit", status: 12345, output: {} }],
    });

    // target: the node is failed with a typed contract event, and the
    // downstream node is NOT started (the flow does not advance on invalid data)
    expect(await harness.nodeStatus(flowId, "build")).toBe("failed");
    const contractEvents = (await harness.events(flowId, { nodeKey: "build" }))
      .filter((e) => e.message.toLowerCase().includes("contract"));
    expect(contractEvents.length).toBeGreaterThan(0);
    expect(await harness.nodeStatus(flowId, "gate")).toBe("pending");
  });
});
