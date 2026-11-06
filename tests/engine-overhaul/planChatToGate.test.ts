/**
 * Sanity (green) characterization: the plan chat → approve → build → gate
 * slice of the SDLC path on fake ports (engine overhaul step 00). A narrower
 * companion to the full happy path — it stops at the gate going green, so it
 * protects the pre-MR half of the chain without paying the review/resolve
 * wait-loop cost.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-plan-gate-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const gitHost = registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

const PLAN_TURN = JSON.stringify({
  reply: "Planned.",
  plan: {
    markdown: "# Plan\n\n1. Only step",
    steps: [{ id: "s1", title: "Only step", detail: "d", files: ["a.ts"] }],
  },
});

describe("plan chat → approve → build → gate (fake ports)", () => {
  it("runs the pre-MR chain and the gate goes green", async () => {
    const flowId = harness.seedSdlcFlow();

    agent.pushRun({ status: "finished", result: PLAN_TURN });
    agent.pushRun({ status: "finished", result: PLAN_TURN });
    flowEngine.sendChat(flowId, NODE_KEYS.PLAN, "plan this task");
    await until(
      () => harness.nodeStatus(flowId, NODE_KEYS.PLAN) === "awaiting_approval",
      "the plan turn to reach awaiting_approval",
    );
    agent.drainQueue();

    flowEngine.approvePlan(flowId);
    expect(harness.nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("approved");

    agent.pushRun({ status: "finished", result: "built and pushed" });
    await harness.runStage(flowId, NODE_KEYS.BUILD);
    expect(harness.nodeStatus(flowId, NODE_KEYS.BUILD)).toBe("awaiting_approval");
    agent.drainQueue();

    flowEngine.approveBuild(flowId);
    await until(
      () => gitHost.calls.some((c) => c.kind === "createChangeRequest"),
      "MR creation on the fake host",
    );

    const mrNumber = gitHost.changeRequests.size;
    gitHost.setHeadPipeline(mrNumber, "success");
    await until(
      () => harness.nodeStatus(flowId, NODE_KEYS.PIPELINE) === "done",
      "the gate to go green",
      45_000,
    );
    expect(harness.nodeStatus(flowId, NODE_KEYS.PIPELINE)).toBe("done");
  }, 60_000);
});
