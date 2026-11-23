/**
 * BuildFinalizer — the build kind's terminal carved out of the build def
 * (§T6/§12): build-progress application to the plan checklist, branch row +
 * run tag, flow branch pointer, and the per-branch review diff artifact.
 *
 * The invariants under test: a missing/unparseable `build-progress` report
 * with pending steps is a typed `output_contract_violation` + FAILED outcome
 * (step 05) — never a silent empty list; the accepted fence logs that the
 * `claim_checklist_progress` API was bypassed (step 08); the outcome is
 * RETURNED, never applied here.
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);
const { nodeSupport } = await import("@/lib/composition/container");
const { FlowContextHelper } = await import("../../shared/runContext/flowContextHelper");
const { BuildFinalizer } = await import("./buildFinalizer");
const { BuildRunSupport } = await import("./buildRunSupport");
const { branchStore } = await import("./branchStore");
const { planSteps } = await import("../../../runtime/planStepStore");
const { BuildOutput } = await import("./schema");
import type { AgentRunResult } from "../../../ports/agentPort";
import type { DiffFile } from "../../../../git/local";
import type { FlowCtx } from "../../shared/nodeSharedExports";

const now = () => new Date().toISOString();

/** A makeDiff stand-in — the helper takes the ctxHelper through its seam. */
class DiffStub extends FlowContextHelper {
  constructor(private readonly diff: { files: DiffFile[]; stat: string; raw: string } | null) {
    super();
  }
  override makeDiff(): Promise<{ files: DiffFile[]; stat: string; raw: string } | null> {
    return Promise.resolve(this.diff);
  }
}

/** One isolated task + flow + build node + plan artifact + synced steps. */
async function seed(index: number, opts: { stepIds?: string[] } = {}): Promise<{ flowId: string; nodeId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "finalizer test", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, `finalizer ${index}`, "active", "cloud", null, now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, "build", "build", "running", now(), now(),
  );
  const artId = `art_plan_${index}`;
  await testRun(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    artId, nodeId, flowId, "plan", 1, "# Plan", null, "draft", now(),
  );
  await planSteps.syncFromPlan(flowId, artId, (opts.stepIds ?? ["s1", "s2"]).map((id, i) => ({ id, title: `Step ${i + 1}`, branch: null })));
  const ctx = {
    flow: { id: flowId, taskId, name: `finalizer ${index}`, status: "active", executionMode: "cloud", mrBranch: null, createdAt: now(), updatedAt: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, nodeId, ctx };
}

const finisherWith = (diff: { files: DiffFile[]; stat: string; raw: string } | null): InstanceType<typeof BuildFinalizer> => {
  const run = new BuildRunSupport(nodeSupport, new DiffStub(diff));
  return new BuildFinalizer(nodeSupport, run, BuildOutput, "build");
};

const pushedResult = (resultText: string): AgentRunResult =>
  ({ status: "finished", result: resultText, git: { branches: [{ branch: "bugfix/pushed-branch" }] } }) as unknown as AgentRunResult;

const fence = (ids: string[]): string =>
  `some work done\n\`\`\`json build-progress\n${JSON.stringify({ completed: ids })}\n\`\`\`\n`;

describe("BuildFinalizer — the build-progress gate (step 05)", () => {
  it("no parseable report with pending steps: FAILED outcome + typed violation event, checklist untouched", async () => {
    const s = await seed(61);
    const outcome = await finisherWith(null).finalize(s.ctx, pushedResult("no report here"), "bugfix/assigned", null, s.nodeId, "run_missing");
    expect(outcome.status).toBe("failed");
    expect(outcome.eventData).toMatchObject({ pending: 2 });
    expect(outcome.reply).toContain("no parseable \"build-progress\" report");
    const events = await testAll<{ type: string; data: { pending?: number } | null }>(
      `SELECT type, data FROM events WHERE node_id=$1 AND type='output_contract_violation'`, s.nodeId,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.data?.pending).toBe(2);
    const steps = await planSteps.list(s.flowId);
    expect(steps.every((st) => st.status === "pending")).toBe(true);
    expect(await branchStore.list(s.flowId)).toEqual([]);
  });

  it("the accepted prose fence marks claimed steps done and logs the API bypass (step 08)", async () => {
    const s = await seed(62);
    const runRowId = await nodeSupport.persistRun(s.flowId, s.nodeId, "agt_f", "run_f");
    const diff = { files: [], stat: "1 file changed", raw: "diff --git a/x b/x" };
    const outcome = await finisherWith(diff).finalize(
      s.ctx, pushedResult(fence(["s1"])), "bugfix/assigned", { name: "br-a", title: "Branch A", scope: "" }, s.nodeId, runRowId,
    );
    expect(outcome.status).toBe("awaiting_approval");
    expect(outcome.output).toMatchObject({ branch: "bugfix/pushed-branch", branchName: "br-a" });
    const steps = await planSteps.list(s.flowId);
    expect(steps.find((st) => st.metaId === "s1")?.status).toBe("done");
    expect(steps.find((st) => st.metaId === "s2")?.status).toBe("pending");
    const logEvents = await testAll<{ message: string; data: { fenceCompleted?: number } | null }>(
      `SELECT message, data FROM events WHERE node_id=$1 AND type='log' AND message LIKE '%bypassed%'`, s.nodeId,
    );
    expect(logEvents).toHaveLength(1);
    expect(logEvents[0]?.data?.fenceCompleted).toBe(1);
    // the branch row records the pushed ref and the run row is tagged for cost attribution
    const rows = await branchStore.list(s.flowId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "br-a", status: "building", gitBranch: "bugfix/pushed-branch" });
    const run = await testGet<{ branchId: string | null }>(`SELECT branch_id AS "branchId" FROM runs WHERE id=$1`, runRowId);
    expect(run?.branchId).toBe(rows[0]?.id);
    // the flow points at the pushed branch
    expect((await testGet<{ mrBranch: string | null }>(`SELECT mr_branch AS "mrBranch" FROM flows WHERE id=$1`, s.flowId))?.mrBranch).toBe("bugfix/pushed-branch");
  });

  it("no report with NOTHING pending: no bypass log, straight to awaiting_approval", async () => {
    const s = await seed(63, { stepIds: [] });
    const outcome = await finisherWith(null).finalize(s.ctx, pushedResult("done, no fence"), "bugfix/assigned", null, s.nodeId, "run_missing");
    expect(outcome.status).toBe("awaiting_approval");
    const logEvents = await testAll<{ message: string }>(
      `SELECT message FROM events WHERE node_id=$1 AND message LIKE '%bypassed%'`, s.nodeId,
    );
    expect(logEvents).toEqual([]);
  });
});
