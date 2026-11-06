/**
 * Characterization (red): a waiting node's resume — webhook delivery and
 * timer fire — must RUN the node, not leave it stranded (engine overhaul
 * step 00; flip in step 03).
 *
 * Current bug (waitScheduler.ts `resumeNodeFromWebhook` / `fireWaitTimer` →
 * edgeActivator.ts:285): the claim flips the node waiting→running, then
 * `startNodeStage` re-checks `status !== "waiting"` and silently returns —
 * the node is left `running` with no run.
 *
 * Restart case is `test.skip` until durable `wait_until` exists (step 03):
 * today waits live in WaitScheduler's in-memory `waitTimers` map, so a
 * restart loses them outright — there is nothing to resume.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-wait-resume-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

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
  // OVERHAUL: flip in step 03
  test.fails("webhook resume runs the node (today the claim strands it running)", async () => {
    const { id: templateId } = importTemplateYaml(templateStore, webhookWaitYaml, {
      namePrefix: "ovh-webhook-wait",
    });
    const flowId = harness.seedFlowFromTemplate(templateId);

    // entry done → gate becomes eligible → arms the webhook wait (waiting)
    harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // webhook delivery resumes the gate: target = the node RUNS to a terminal
    flowEngine.resumeNodeFromWebhook(flowId, "gate", { delivery: true });
    await until(
      () => harness.nodeStatus(flowId, "gate") === "done",
      "the resumed gate to run to done",
    );
    expect(harness.nodeStatus(flowId, "gate")).toBe("done");
  }, 15_000);

  // OVERHAUL: flip in step 03
  test.fails("timer resume runs the node (today the claim strands it running)", async () => {
    const { id: templateId } = importTemplateYaml(templateStore, timerWaitYaml, {
      namePrefix: "ovh-timer-wait",
    });
    const flowId = harness.seedFlowFromTemplate(templateId);

    harness.setNodeForFixture(flowId, "entry", "done");
    await harness.advance(flowId, "entry");
    expect(harness.nodeStatus(flowId, "gate")).toBe("waiting");

    // timer fire resumes the gate: target = the node RUNS to a terminal
    flowEngine.processWaitTimers();
    await until(
      () => harness.nodeStatus(flowId, "gate") === "done",
      "the timer-fired gate to run to done",
    );
    expect(harness.nodeStatus(flowId, "gate")).toBe("done");
  }, 15_000);

  // OVERHAUL: flip in step 03 (restart needs durable wait_until — skipped until then)
  test.skip("restart during a wait resumes the node (needs durable wait_until)", () => {
    // Step 03: waits persist on nodes.wait_until; a fresh process re-arms and
    // fires them. Today WaitScheduler.waitTimers is in-memory, so a restart
    // loses the deadline entirely — there is nothing to drive here yet.
  });
});
