/**
 * Sanity (green) characterization: the plan chat → approve → build → gate
 * slice of the SDLC path on fake ports (engine overhaul step 00). A narrower
 * companion to the full happy path — it stops at the gate going green, so it
 * protects the pre-MR half of the chain without paying the review/resolve
 * wait-loop cost.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness, until } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const gitHost = registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const PLAN_TURN = JSON.stringify({
  reply: "Planned.",
  plan: {
    markdown: "# Plan\n\n1. Only step",
    steps: [{ id: "s1", title: "Only step", detail: "d", files: ["a.ts"] }],
  },
});

describe("plan chat → approve → build → gate (fake ports)", () => {
  it("runs the pre-MR chain and the gate goes green", async () => {
    const flowId = await harness.seedSdlcFlow();

    agent.pushRun({ status: "finished", result: PLAN_TURN });
    agent.pushRun({ status: "finished", result: PLAN_TURN });
    flowEngine.sendChat(flowId, NODE_KEYS.PLAN, "plan this task");
    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.PLAN)) === "awaiting_approval",
      "the plan turn to reach awaiting_approval",
    );
    agent.drainQueue();

    await flowEngine.approvePlan(flowId);
    expect(await harness.nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("approved");

    agent.pushRun({ status: "finished", result: "built and pushed" });
    await harness.runStage(flowId, NODE_KEYS.BUILD);
    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.BUILD)) === "awaiting_approval",
      "the build run to land awaiting_approval",
    );
    expect(await harness.nodeStatus(flowId, NODE_KEYS.BUILD)).toBe("awaiting_approval");
    agent.drainQueue();

    flowEngine.approveBuild(flowId);
    await until(
      () => gitHost.calls.some((c) => c.kind === "createChangeRequest"),
      "MR creation on the fake host",
    );

    const mrNumber = gitHost.changeRequests.size;
    gitHost.setHeadPipeline(mrNumber, "success");
    await until(
      async () => (await harness.nodeStatus(flowId, NODE_KEYS.PIPELINE)) === "done",
      "the gate to go green",
      45_000,
    );
    expect(await harness.nodeStatus(flowId, NODE_KEYS.PIPELINE)).toBe("done");
  }, 60_000);
});
