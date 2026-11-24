/**
 * BuildTriggerPlanner — the engine-trigger materialization carved out of the
 * build def (§T6/§12): the approved-plan read and the single build run carrying
 * the plan-run model through.
 *
 * The invariants under test: a corrupt plan meta is a typed failure (step
 * 05) and the plan model comes from the PLAN node's validated output contract.
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);
const { nodeSupport } = await import("@/lib/composition/container");
const { BuildTriggerPlanner } = await import("./buildTriggerPlanner");
const { NODE_KEYS } = await import("../../../constants/nodeKeys");
import type { FlowCtx } from "../../shared/nodeSharedExports";

const now = () => new Date().toISOString();

/** One isolated task + flow + plan node (+ optional plan artifact + output). */
async function seed(index: number, opts: { planContent?: string; planMeta?: unknown; planOutput?: Record<string, unknown> } = {}): Promise<{ flowId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const planNodeId = `node_plan_${index}`;
  const artId = `art_plan_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "trigger planner test", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, `planner ${index}`, "active", "cloud", null, now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    planNodeId, flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN, "done", now(), now(),
  );
  if (opts.planContent != null) {
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      artId, planNodeId, flowId, "plan", 1, opts.planContent, opts.planMeta ? JSON.stringify(opts.planMeta) : null, "draft", now(),
    );
  }
  if (opts.planOutput) {
    await nodeSupport.setNode(planNodeId, { output: JSON.stringify(opts.planOutput) });
  }
  const ctx = {
    flow: { id: flowId, taskId, name: `planner ${index}`, status: "active", executionMode: "cloud", mrBranch: null, triggerPayload: null, createdAt: now(), updatedAt: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, ctx };
}

describe("BuildTriggerPlanner — triggerRuns", () => {
  it("single-branch fast path: the approved plan content + the plan run's validated model", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(53, { planContent: "# The plan", planOutput: { latestArtifact: "art_plan_53", version: 1, model: "model-x" } });
    const runs = await planner.triggerRuns(s.ctx);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.input).toEqual({
      plan: "# The plan", prompt: null, branchInfo: null, feedback: null, model: "model-x",
    });
  });

  it("a CORRUPT plan meta is a typed failure, not a silent single-branch fallback (step 05)", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(55, { planContent: "# plan", planMeta: { steps: "bogus" } });
    await expect(planner.triggerRuns(s.ctx)).rejects.toThrow(/does not satisfy the plan contract/);
  });

  it("no approved plan artifact fails loudly", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(56);
    await expect(planner.triggerRuns(s.ctx)).rejects.toThrow(/no plan to build/);
  });
});
