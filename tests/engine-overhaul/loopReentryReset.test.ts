/**
 * Sanity (green) characterization: a loop edge's re-entry resets the
 * downstream success terminals back to pending so the cycle runs again
 * (engine overhaul step 00). Mirrors `flowEngineLoopReset.test.ts`'s inline
 * decision graph through the step-00 harness — the reset is pure
 * EdgeActivator behavior, so terminal states are placed via fixture writes
 * and the assertion reads the reset after a bare `advanceFrom`.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-loop-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");

const harness = new FlowHarness({ db, flowEngine, templateStore });

const loopYaml = `
name: Overhaul loop reset
trigger:
  type: manual
nodes:
  - key: pass_a
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
  - key: pick
    type: decision
    config:
      source: expression
      choices:
        - label: fix
          condition: "true"
        - label: ship
          condition: "true"
  - key: fix_path
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
  - key: ship_path
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
edges:
  - [pass_a, pick]
  - [pick, fix_path, {label: fix}]
  - [pick, ship_path, {label: ship}]
  - [fix_path, pass_a, {kind: loop, condition: "true"}]
`;

describe("loop re-entry resets downstream terminals", () => {
  it("a loop edge re-entry clears the skipped branch before the next iteration", async () => {
    const { id: templateId } = importTemplateYaml(templateStore, loopYaml, {
      namePrefix: "ovh-loop",
    });
    const flowId = harness.seedFlowFromTemplate(templateId);

    // first iteration's terminal state (fixture setup): the decision picked
    // "fix", so fix_path ran and ship_path was skipped
    harness.setNodeForFixture(flowId, "pass_a", "done");
    harness.setNodeOutputForFixture(flowId, "pick", "done", { chosen: ["fix"], rationale: "t" });
    harness.setNodeForFixture(flowId, "fix_path", "done");
    harness.setNodeForFixture(flowId, "ship_path", "skipped");

    // the loop edge back to pass_a re-enters the cycle: the skipped branch
    // resets to pending so the second iteration's decision can choose it
    await harness.advance(flowId, "fix_path");
    expect(harness.nodeStatus(flowId, "ship_path")).toBe("pending");

    // second iteration: the decision now picks "ship" — its branch must not
    // still hold the stale skipped state
    harness.setNodeOutputForFixture(flowId, "pick", "done", { chosen: ["ship"], rationale: "t" });
    await harness.advance(flowId, "pick");
    expect(harness.nodeStatus(flowId, "ship_path")).not.toBe("skipped");
  });
});
