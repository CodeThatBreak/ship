/**
 * A valid `[]` is the review contract's "no findings" answer — the prompt
 * literally says "If none, return []" (promptDefaults.ts). It must complete
 * the node with `comments: 0`, unlike empty/unparseable output, which step 05
 * made a loud failure (agentOutputFallbacks.test.ts).
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

describe("review with no findings", () => {
  test("a valid [] completes with 0 posted comments", async () => {
    const flowId = await harness.seedSdlcFlow();
    const { registerFakeGitHost } = await import("../helpers/fakeGitHost");
    const gitHost = registerFakeGitHost();
    gitHost.addChangeRequest({ number: 1, sha: "sha_1" });
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-no-findings", flowId);

    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "[]" }); // clean review — no findings
    await harness.runStage(flowId, "review");

    expect(await harness.nodeStatus(flowId, "review")).toBe("done");
    expect(await harness.nodeOutput(flowId, "review")).toMatchObject({ comments: 0 });
  }, 15_000);
});
