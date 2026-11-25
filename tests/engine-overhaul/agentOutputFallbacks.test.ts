/**
 * Every silent default in the agent-output path is a loud, typed failure —
 * missing output is a first-class state, never a fabricated value (engine
 * overhaul step 05; the step-00 red markers are flipped).
 *
 * Current fallbacks under test (each cited in the step-00 file):
 *  - review reply that is empty, unparseable, or a bare array ⇒ failed (the
 *    response contract is `{verdict, comments}`, so "clean" must be said with
 *    `approve`; a missing answer never reads as a quiet pass).
 *    `reviewNode.ts` `reviewOutcome` — the clean branch is `approve` + no
 *    comments, which is a DONE run that posts nothing.
 *  - decision case-mismatched label ⇒ today case-insensitively salvaged
 *    (`decisionNode.ts:334-336`).
 *  - agent markdown empty ⇒ today the fabricated `"(empty response)"`
 *    (`agentNode.ts:559` — now `agentOutcome.ts`, the empty-markdown guard).
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
// `cwd: repo` script leaves need a registered repo with a local checkout dir
await harness.registerRepoWithLocalPath(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-ovh-fallback-repo-")));

beforeAll(resetTestDatabase);

// the git-host registry is process-global and forbids duplicate kinds — one
// registration per test file (the fakeGitHost helper's convention); each test
// clears the call log rather than re-registering
const { registerFakeGitHost } = await import("../helpers/fakeGitHost");
const gitHost = registerFakeGitHost();

/** An SDLC flow with the review node ready to run (MR linkage faked). */
const seedReviewReady = async () => {
  const flowId = await harness.seedSdlcFlow();
  const mrNumber = 1;
  // MR + linkage the review node resolves (flow-level mr_iid)
  const gitNumber = mrNumber;
  return { flowId, mrNumber: gitNumber };
};

describe("agent output silent defaults become loud failures", () => {
  test("review empty reply ⇒ failed (a missing answer is never done-with-0)", async () => {
    const { flowId } = await seedReviewReady();
    // the MR + its host so resolveMr/getChanges/getChangeRequest succeed
    gitHost.addChangeRequest({ number: 1, sha: "sha_1" });
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-fallback", flowId);

    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "   " }); // empty reply
    await harness.runStage(flowId, "review");

    // target: empty review output is a failed node, never a silent done-0
    expect(await harness.nodeStatus(flowId, "review")).toBe("failed");
  }, 15_000);

  test("review bare [] ⇒ failed (the verdict is what says 'clean')", async () => {
    const { flowId } = await seedReviewReady();
    gitHost.addChangeRequest({ number: 1, sha: "sha_1" });
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-fallback", flowId);

    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "[]" }); // the old clean shape
    await harness.runStage(flowId, "review");

    // an unqualified empty list never masquerades as an approval
    expect(await harness.nodeStatus(flowId, "review")).toBe("failed");
  }, 15_000);

  test("review approve with no comments ⇒ done, posting nothing", async () => {
    const { flowId } = await seedReviewReady();
    gitHost.addChangeRequest({ number: 1, sha: "sha_1" });
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-fallback", flowId);
    const postsBefore = gitHost.calls.length;

    agent.drainQueue();
    agent.pushRun({ status: "finished", result: '{"verdict":"approve","comments":[]}' });
    await harness.runStage(flowId, "review");

    // a clean review is a real outcome: done, zero host posts
    expect(await harness.nodeStatus(flowId, "review")).toBe("done");
    expect(gitHost.calls.length).toBe(postsBefore);
  }, 15_000);
  test("decision case-mismatched label ⇒ failed (today case-insensitively salvaged)", async () => {
    const flowId = await harness.seedInlineFlow(
      [
        {
          key: "pick",
          def: "nt_st_ship_decision",
          trigger: { type: "auto" },
          config: {
            source: "agent",
            question: "pick one",
            choices: [{ label: "Fix" }, { label: "Ship" }],
          },
        },
        { key: "fix_path", def: "nt_st_write_doc", config: { runtime: "shell", script: "echo '{}'" } },
        { key: "ship_path", def: "nt_st_write_doc", config: { runtime: "shell", script: "echo '{}'" } },
      ],
      [
        { from: "pick", to: "fix_path", label: "Fix" },
        { from: "pick", to: "ship_path", label: "Ship" },
      ],
    );

    // the agent returns the label in the wrong case — target: a typed failure,
    // today it is case-insensitively salvaged to the "Fix" branch
    agent.drainQueue();
    agent.pushRun({ status: "finished", result: JSON.stringify({ choice: "fix", rationale: "lower" }) });
    await harness.runStage(flowId, "pick");

    expect(await harness.nodeStatus(flowId, "pick")).toBe("failed");
  }, 15_000);

  test("agent markdown empty ⇒ failed (today fabricated as \"(empty response)\")", async () => {
    const flowId = await harness.seedInlineFlow(
      [
        {
          key: "scribe",
          def: "nt_st_summarize",
          trigger: { type: "auto" },
          config: { mode: "plan", output: "markdown", prompt: "write" },
        },
      ],
      [],
    );

    agent.drainQueue();
    agent.pushRun({ status: "finished", result: "   " }); // empty markdown
    await harness.runStage(flowId, "scribe");

    // target: an empty markdown body fails loudly — never the fabricated
    // "(empty response)" placeholder
    expect(await harness.nodeStatus(flowId, "scribe")).toBe("failed");
    const out = await harness.nodeOutput(flowId, "scribe");
    expect(out?.markdown).not.toBe("(empty response)");
  }, 15_000);
});
