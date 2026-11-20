/**
 * Fan-out aggregate publish through the transition authority (engine overhaul
 * step 02): `finishFanout` publishes a fan-out node's terminal through the
 * declared `fanoutOutcome` transition — from-set fenced on `running`, output
 * in the same statement — and the in-memory transition-log assert verifies
 * every transition the path drove resolves against the declared table.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testGet } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import type { StepRollup } from "@/lib/engine/runtime/fanout/stepRollup";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { expectTransitionsDeclared } from "../helpers/transitionLogAssert";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { stepFlows } = await import("@/lib/engine/runtime/fanout/stepFlowManager");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

/** the aggregate publish moved off FlowEngine into the fan-out runtime's
 *  StepRollup (step 07) — tests drive it through the bound facade's rollup */
const rollup = (stepFlows as unknown as { rollup: StepRollup }).rollup;

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

/** A fan-out node with no downstream edges: the publish is fully observable
 *  without the edge advance starting anything else. */
const fanoutYaml = `
name: Overhaul fanout aggregate publish
trigger:
  type: manual
nodes:
  - key: build
    type: builtin/build
edges: []
`;

const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");

describe("fan-out aggregate publish (step 02)", () => {
  test("finishFanout publishes the aggregate through the declared fanoutOutcome transition", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, fanoutYaml, {
      namePrefix: "ovh-fanout",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);

    // the fan-out consumer is mid-run (a stage claim holds it running)
    await harness.claimNode(flowId, "build", "runFromPending");
    expect(await harness.nodeStatus(flowId, "build")).toBe("running");

    await rollup.finishFanout(flowId, "build", {
      steps: [{ id: "s1", title: "Step one", status: "done", output: {} }],
    });

    // the aggregate landed: terminal status + the validated steps shape
    expect(await harness.nodeStatus(flowId, "build")).toBe("done");
    const output = await testGet<{ output: unknown }>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='build'`,
      flowId,
    );
    const steps = (output?.output as { steps?: unknown[] }).steps;
    expect(Array.isArray(steps)).toBe(true);
    expect(steps?.length).toBe(1);

    // a stale re-publish loses silently — the from-set no longer holds
    await rollup.finishFanout(flowId, "build", {
      steps: [{ id: "s2", title: "Step two", status: "done", output: {} }],
    });
    expect((await testGet<{ output: unknown }>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='build'`,
      flowId,
    ))?.output).toEqual(output?.output);

    // step-02 task 6: every transition this path drove is declared
    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });
});
