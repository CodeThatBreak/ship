/**
 * Sanity (green) characterization: the SDLC happy path end-to-end on fake
 * ports (engine overhaul step 00). Protects the step-01 persistence
 * migration — it must pass identically before and after.
 *
 * Path: plan chat turn publishes a plan → approve → build (whole) →
 * approveBuild (fake host creates the MR) → pipeline gate sees a green head
 * pipeline → review posts comments → debounced resolve is armed by the
 * review's edge.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-happy-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const gitHost = registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

const PLAN_TURN = JSON.stringify({
  reply: "Planned in two steps.",
  plan: {
    markdown: "# Plan\n\n1. First\n2. Second",
    steps: [
      { id: "s1", title: "First", detail: "d1", files: ["a.ts"] },
      { id: "s2", title: "Second", detail: "d2", files: ["b.ts"] },
    ],
  },
});

const REVIEW_COMMENTS = JSON.stringify([
  { file: "a.ts", line: 3, body: "nit: rename this" },
]);

describe("SDLC happy path (fake ports)", () => {
  it("plan → approve → build → gate → review → resolve arms", async () => {
    const flowId = harness.seedSdlcFlow();
    const planKey = flowEngine.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("expected a plan node");

    // plan chat turn → awaiting_approval. The plan contract may re-prompt
    // the same agent once on a contract miss (self-heal), consuming a second
    // stream — push a sacrificial duplicate, then drain the queue so the
    // next stage's first pushRun is that run's outcome.
    agent.pushRun({ status: "finished", result: PLAN_TURN });
    agent.pushRun({ status: "finished", result: PLAN_TURN });
    flowEngine.sendChat(flowId, planKey, "plan this task");
    await until(
      () => harness.nodeStatus(flowId, planKey) === "awaiting_approval",
      "the plan turn to reach awaiting_approval",
    );
    agent.drainQueue();

    // approve the plan — the plan→build edge makes the build eligible
    flowEngine.approvePlan(flowId);
    expect(harness.nodeStatus(flowId, planKey)).toBe("approved");

    // build (whole): the agent ships a branch and reports it
    const buildKey = flowEngine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected a build node");
    agent.pushRun({ status: "finished", result: "built and pushed" });
    await harness.runStage(flowId, buildKey);
    expect(harness.nodeStatus(flowId, buildKey)).toBe("awaiting_approval");
    agent.drainQueue();

    // approve the build — MR creation runs on the fake host, and the
    // build→pipeline edge auto-starts the gate's wait loop (auto trigger)
    flowEngine.approveBuild(flowId);
    await until(
      () => gitHost.calls.some((c) => c.kind === "createChangeRequest"),
      "MR creation on the fake host",
    );

    // the gate's wait loop is already running; turn the MR's head pipeline
    // green and the loop's next poll picks it up. The gate→review edge then
    // auto-starts review — script the review outcome BEFORE the gate finishes.
    const gateKey = flowEngine.gateKey(flowId);
    if (!gateKey) throw new Error("expected a pipeline gate node");
    const reviewKey = flowEngine.keyOfRole(flowId, NODE_KEYS.REVIEW);
    if (!reviewKey) throw new Error("expected a review node");
    agent.pushRun({ status: "finished", result: REVIEW_COMMENTS });
    const mrNumber = gitHost.changeRequests.size;
    gitHost.setHeadPipeline(mrNumber, "success");
    await until(() => harness.nodeStatus(flowId, gateKey) === "done", "the gate to go green", 45_000);
    await until(() => harness.nodeStatus(flowId, reviewKey) === "done", "review to finish");
    expect(harness.nodeStatus(flowId, reviewKey)).toBe("done");

    // the review→resolve edge arms the debounced resolve (waiting on comments)
    const resolveKey = flowEngine.keyOfRole(flowId, NODE_KEYS.RESOLVE);
    if (!resolveKey) throw new Error("expected a resolve node");
    await until(
      () => harness.nodeStatus(flowId, resolveKey) === "waiting",
      "the debounced resolve to arm",
    );
    expect(harness.nodeStatus(flowId, resolveKey)).toBe("waiting");
  }, 60_000); // the gate's wait loop polls on the app default (≈20s)
});
