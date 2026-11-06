/**
 * Characterization (red): every silent default in the agent-output path must
 * become a loud, typed failure — missing output is a first-class state, never
 * a fabricated value (engine overhaul step 00; flip in step 05).
 *
 * Current fallbacks under test (each cited in the step-00 file):
 *  - review empty reply ⇒ today a silent done-with-0-comments
 *    (`reviewNode.ts:177-190`: the failed branch needs a non-empty body that
 *    still doesn't parse; an empty body falls through to done-0).
 *  - decision case-mismatched label ⇒ today case-insensitively salvaged
 *    (`decisionNode.ts:334-336`).
 *  - agent markdown empty ⇒ today the fabricated `"(empty response)"`
 *    (`agentNode.ts:559`).
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeAgentPort } from "../helpers/fakeAgentPort";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-agent-fallbacks-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v));
const harness = new FlowHarness({ db, flowEngine, templateStore });
// `cwd: repo` script leaves need a registered repo with a local checkout dir
harness.registerRepoWithLocalPath(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-ovh-fallback-repo-")));

/** An SDLC flow with the review node ready to run (MR linkage faked). */
const seedReviewReady = () => {
  const flowId = harness.seedSdlcFlow();
  const mrNumber = 1;
  // MR + linkage the review node resolves (flow-level mr_iid)
  const gitNumber = mrNumber;
  return { flowId, mrNumber: gitNumber };
};

describe("agent output silent defaults become loud failures", () => {
  // OVERHAUL: flip in step 05
  test.fails("review empty reply ⇒ failed (today a silent done-with-0)", async () => {
    const { flowId } = seedReviewReady();
    // fake the MR + its host so resolveMr/getChanges/getChangeRequest succeed
    const { registerFakeGitHost } = await import("../helpers/fakeGitHost");
    const gitHost = registerFakeGitHost();
    gitHost.addChangeRequest({ number: 1, sha: "sha_1" });
    db.run(`UPDATE flows SET mr_iid=?, mr_branch=? WHERE id=?`, 1, "devflow/ovh-fallback", flowId);

    agent.pushRun({ status: "finished", result: "   " }); // empty reply
    await harness.runStage(flowId, "review");

    // target: empty review output is a failed node, never a silent done-0
    expect(harness.nodeStatus(flowId, "review")).toBe("failed");
  }, 15_000);

  // OVERHAUL: flip in step 05
  test.fails("decision case-mismatched label ⇒ failed (today case-insensitively salvaged)", async () => {
    const flowId = harness.seedInlineFlow(
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

    expect(harness.nodeStatus(flowId, "pick")).toBe("failed");
  }, 15_000);

  // OVERHAUL: flip in step 05
  test.fails("agent markdown empty ⇒ failed (today fabricated as \"(empty response)\")", async () => {
    const flowId = harness.seedInlineFlow(
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
    expect(harness.nodeStatus(flowId, "scribe")).toBe("failed");
    const out = harness.nodeOutput(flowId, "scribe");
    expect(out?.markdown).not.toBe("(empty response)");
  }, 15_000);
});
