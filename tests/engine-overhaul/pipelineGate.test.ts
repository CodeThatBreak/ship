/**
 * Characterization (red): the pipeline gate's terminal output must always
 * satisfy its declared schema — and a restart mid-wait must resume the gate
 * (engine overhaul step 00; flip in step 05).
 *
 * Current bug (`pipelineNode.ts:529-546`): on the deadline-timeout path the
 * node publishes `output ?? {}` — when no head pipeline was ever seen, that
 * bare `{}` violates the declared `PipelineOutput` schema (pipelineId is
 * required), so the terminal write is not schema-valid.
 *
 * Restart mid-wait is `test.skip` until the wait's progress is durable
 * (step 05): today the gate's `fixes`/`manualPlays`/attempt counters live in
 * the in-process wait loop, so a restart discards them.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-pipeline-gate-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");

registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

describe("pipeline gate terminal output is schema-valid", () => {
  // OVERHAUL: flip in step 05
  test.fails("deadline timeout with no head pipeline publishes a schema-valid PipelineOutput", async () => {
    const flowId = harness.seedSdlcFlow();
    db.run(`UPDATE flows SET mr_iid=?, mr_branch=? WHERE id=?`, 1, "devflow/ovh-gate", flowId);

    const spec = harness.graphForFlow(flowId)?.byKey.get("pipeline");
    if (!spec) throw new Error("expected a pipeline node");
    const def = nodeRegistry.resolve(spec.defKey, "pipeline");
    const ctx = flowEngine.ctx(flowId);
    const node = db.get<import("@/lib/db/rows").NodeRow>(
      `SELECT * FROM nodes WHERE flow_id=? AND node_key='pipeline'`,
      flowId,
    );
    if (!node) throw new Error("no pipeline node row");

    // drive the gate's run directly with a zero-length deadline: it must time
    // out immediately having never seen a head pipeline. Target: the run
    // resolves a terminal outcome whose output satisfies PipelineOutput —
    // today the timeout path's `output ?? {}` violates the schema (the
    // node's own outputSchema.parse rejects it inside the outcome path).
    const { PipelineOutput } = await import("@/lib/engine/nodes/kinds/pipeline/schema");
    let outcomeOutput: unknown;
    try {
      const outcome = await def.run(
        ctx,
        { branchName: null, pipelineId: null, guidance: null, model: null, prompt: null, promptIsBody: false },
        { gate_timeout_min: 0, poll_interval_sec: 0, max_fix_attempts: 0 },
      );
      outcomeOutput = outcome.output;
    } catch {
      outcomeOutput = undefined; // today: the invalid output throws before an outcome
    }
    expect(() => PipelineOutput.parse(outcomeOutput)).not.toThrow();
  }, 15_000);

  // OVERHAUL: flip in step 05 (restart resume needs durable gate progress)
  test.skip("restart mid-wait resumes the gate from durable progress", () => {
    // Step 05: the gate's fixes/manualPlays/attempt counters persist on the
    // node row / artifact meta; recover() re-enters the wait. Today the wait
    // loop is in-process only, so a restart discards it — nothing to drive yet.
  });
});
