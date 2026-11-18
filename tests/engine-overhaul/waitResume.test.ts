/**
 * Wait resume (green — engine overhaul step 03): a waiting node's resume —
 * webhook delivery, timer fire, and restart — RUNS the node to a terminal.
 *
 * The step-00 bug is fixed by the durable WaitStore: firing no longer
 * pre-claims the node (the old pre-claim made `startNodeStage`'s own
 * `resumeWait` claim conflict and silently return, stranding the node
 * `running` with no run) — the claim and the stage run live together in
 * `startNodeStage`. Waits persist on `nodes.wait_until`, so the restart case
 * is a fresh WaitStore sweeping the table.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { WaitStore } = await import("@/lib/engine/runtime/waits/waitStore");
const { engineParts } = await import("@/lib/composition/container");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

/** A webhook-waiting agent node fed by an entry script (so it has an input). */
const webhookWaitYaml = `
name: Overhaul webhook wait
trigger:
  type: manual
nodes:
  - key: entry
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
  - key: gate
    type: agent
    trigger:
      type: auto
      wait_for: webhook
    config:
      mode: plan
      output: markdown
      prompt: "Ack the delivery."
edges:
  - [entry, gate]
`;

const timerWaitYaml = `
name: Overhaul timer wait
trigger:
  type: manual
nodes:
  - key: entry
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
  - key: gate
    type: agent
    trigger:
      type: auto
      wait_for: timer
      minutes: 0
    config:
      mode: plan
      output: markdown
      prompt: "Ack the timer."
edges:
  - [entry, gate]
`;

const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");

describe("wait resume runs the node", () => {
  // OVERHAUL: flipped green in step 03 (durable WaitStore, single-owner claim)
  test("webhook resume runs the node", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, webhookWaitYaml, {
      namePrefix: "ovh-webhook-wait",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);

    // entry done → gate becomes eligible → arms the webhook wait (waiting)
    await harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(await harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // the resumed stage runs one agent turn — script its outcome
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "delivery acknowledged." });

    // webhook delivery resumes the gate: target = the node RUNS to a terminal
    await flowEngine.resumeNodeFromWebhook(flowId, "gate", { delivery: true });
    await until(
      async () => (await harness.nodeStatus(flowId, "gate")) === "done",
      "the resumed gate to run to done",
    );
    expect(await harness.nodeStatus(flowId, "gate")).toBe("done");
  }, 15_000);

  // OVERHAUL: flipped green in step 03
  test("timer resume runs the node", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, timerWaitYaml, {
      namePrefix: "ovh-timer-wait",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);

    await harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(await harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // the fired stage runs one agent turn — script its outcome
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "timer acknowledged." });

    // timer fire resumes the gate: target = the node RUNS to a terminal
    await flowEngine.processWaitTimers();
    await until(
      async () => (await harness.nodeStatus(flowId, "gate")) === "done",
      "the timer-fired gate to run to done",
    );
    expect(await harness.nodeStatus(flowId, "gate")).toBe("done");
  }, 15_000);

  // OVERHAUL: flipped green in step 03 — waits are durable (`nodes.wait_until`)
  test("restart during a wait resumes the node", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, timerWaitYaml, {
      namePrefix: "ovh-restart-wait",
    });
    const flowId = await harness.seedFlowFromTemplate(templateId);

    await harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(await harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // the fired stage runs one agent turn — script its outcome
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "restart acknowledged." });

    // "restart": a FRESH WaitStore instance (a new process) sweeps the durable
    // deadline — nothing was held in memory, so nothing is lost
    const freshProcessWaits = new WaitStore(flowEngine, engineParts.events);
    await freshProcessWaits.sweepDueWaits();
    await until(
      async () => (await harness.nodeStatus(flowId, "gate")) === "done",
      "the restarted wait sweep to fire the gate to done",
    );
    expect(await harness.nodeStatus(flowId, "gate")).toBe("done");
  }, 15_000);
});
