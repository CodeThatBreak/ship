/**
 * BuildTriggerPlanner — the engine-trigger materialization carved out of the
 * build def (§T6/§12): split-child unit consumption, the approved-plan read,
 * and the multi-branch sequential decomposition (branch rows first, topo
 * order, plan-run model carried through).
 *
 * The invariants under test: a corrupt plan meta is a typed failure (step
 * 05), the plan model comes from the PLAN node's validated output contract,
 * and a split child's unit payload rides straight into the run input.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../../db/app");

beforeAll(resetTestDatabase);
const { nodeSupport } = await import("@/lib/composition/container");
const { BuildTriggerPlanner } = await import("./buildTriggerPlanner");
const { branchStore } = await import("./branchStore");
const { NODE_KEYS } = await import("../../../constants/nodeKeys");
import type { FlowCtx } from "../../shared/nodeSharedExports";

const now = () => new Date().toISOString();

/** One isolated task + flow + plan node (+ optional plan artifact + output). */
async function seed(index: number, opts: { planContent?: string; planMeta?: unknown; planOutput?: Record<string, unknown> } = {}): Promise<{ flowId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const planNodeId = `node_plan_${index}`;
  const artId = `art_plan_${index}`;
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "trigger planner test", "open", "story", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, `planner ${index}`, "active", "cloud", null, now(), now(),
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    planNodeId, flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN, "done", now(), now(),
  );
  if (opts.planContent != null) {
    await db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      artId, planNodeId, flowId, "plan", 1, opts.planContent, opts.planMeta ? JSON.stringify(opts.planMeta) : null, "draft", now(),
    );
  }
  if (opts.planOutput) {
    await nodeSupport.setNode(planNodeId, { output: JSON.stringify(opts.planOutput) });
  }
  const ctx = {
    flow: { id: flowId, taskId, name: `planner ${index}`, status: "active", executionMode: "cloud", mrBranch: null, parentFlowId: null, triggerPayload: null, createdAt: now(), updatedAt: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, ctx };
}

const withPayload = (ctx: FlowCtx, payload: unknown): FlowCtx =>
  ({ ...ctx, flow: { ...ctx.flow, triggerPayload: payload } }) as FlowCtx;

const branchInput = (run: { input: { branchInfo: { name: string } | null } }) => run.input.branchInfo?.name ?? null;

describe("BuildTriggerPlanner — split-child consumption (§2.4 Phase 6)", () => {
  it("triggerInput maps the unit payload into the run input; null on an ordinary parent-flow build", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(51);
    const unit = { unit: { item: { name: "feat-auth", title: "Auth branch", scope: "src/auth", plan: "# Branch plan" } } };
    expect(planner.triggerInput(withPayload(s.ctx, unit))).toEqual({
      plan: "# Branch plan",
      prompt: null,
      promptIsBody: false,
      branchInfo: { name: "feat-auth", title: "Auth branch", scope: "src/auth" },
      feedback: null,
      model: null,
    });
    expect(planner.triggerInput(s.ctx)).toBeNull();
  });

  it("a PRESENT-but-malformed unit throws — fail loud, never the wrong build", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(52);
    expect(() => planner.triggerInput(withPayload(s.ctx, { unit: { item: { name: "x" } } }))).toThrow();
  });
});

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

  it("multi-branch plans come back as sequential runs in topo order, branch rows pending first", async () => {
    const planner = new BuildTriggerPlanner(nodeSupport);
    const s = await seed(54, {
      planContent: "# Branchy plan",
      planMeta: {
        steps: [],
        branches: [
          { name: "br-b", title: "Branch B", dependsOn: ["br-a"] },
          { name: "br-a", title: "Branch A" },
        ],
      },
    });
    const runs = await planner.triggerRuns(s.ctx);
    expect(runs).toHaveLength(2);
    expect(branchInput(runs[0] as never)).toBe("br-a");
    expect(branchInput(runs[1] as never)).toBe("br-b");
    const rows = await branchStore.list(s.flowId);
    expect(rows.map((r) => ({ name: r.name, order: r.order, status: r.status }))).toEqual([
      { name: "br-a", order: 0, status: "pending" },
      { name: "br-b", order: 1, status: "pending" },
    ]);
    const events = await db.all<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND message LIKE '%building sequentially%'`, s.flowId,
    );
    expect(events).toHaveLength(1);
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
