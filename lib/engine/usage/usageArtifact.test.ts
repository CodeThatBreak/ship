import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { testAll, testGet, testRun } from "../../../tests/helpers/rawTestDb";
import type { Started, AgentStartInput, ExecuteRunResult } from "../harness/types/agentRunTypes";
import type { AgentRunResult } from "../ports/agentPort";
import type { FlowCtx } from "../nodes/shared/nodeSharedExports";
import type { RunCostSummary } from "../harness/types/runCostSummary";

// Must run before any `../../db` import touches the connection — dynamic
// imports below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../db/app");
beforeAll(resetTestDatabase);
const { AgentRunner } = await import("../harness/agentRunner/agentRunner");
const { AgentTemplateNode } = await import("../nodes/kinds/agent/agentTemplateNode");
const { PlanNode } = await import("../nodes/kinds/plan/planNode");
const { flowCtxHelper } = await import("../nodes/shared/runContext");
const { nodeSupport } = await import("@/lib/composition/container");
const { usageTracker } = await import("../harness/usageTracker");
const { config } = await import("../../config");
const { agentPortRegistry } = await import("../ports/agentPort");
const { worktreeManager } = await import("../runtime/worktreeLifecycle");
const { hasRunUsage, runUsagePayload } = await import("./runUsagePayload");

const now = () => new Date().toISOString();

/** A task + flow (+ one node row for artifact writes); returns the node row id. */
const seedFlow = async (
  flowId: string,
  node: { key: string; type: string } = { key: "agent_1", type: "agent" },
): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    `BR-${flowId}`,
    "usage artifact test",
    "open",
    "story",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId,
    taskId,
    "usage artifact test",
    "active",
    now(),
    now(),
  );
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId,
    flowId,
    node.key,
    node.type,
    "running",
    now(),
    now(),
  );
  return nodeId;
};

/** A minimal FlowCtx over a seeded flow (the run path reads flow/task fields only). */
const usageCtx = (flowId: string): FlowCtx =>
  ({
    flow: { id: flowId, taskId: `task_${flowId}`, name: "usage artifact test", status: "active", executionMode: "cloud", createdAt: now(), updatedAt: now() },
    task: { id: `task_${flowId}`, type: "generic", key: `BR-${flowId}`, summary: "usage artifact test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  }) as unknown as FlowCtx;

/** executeRun stand-in (the factStore.test.ts pattern) whose result carries
 *  the captured usage summary — the seam Task 21's artifact rides. */
class UsageTestRunner extends AgentRunner {
  private readonly queue: { result: AgentRunResult; usage?: RunCostSummary }[];

  constructor(...runs: { result: AgentRunResult; usage?: RunCostSummary }[]) {
    super(flowCtxHelper, nodeSupport, usageTracker, db, config, agentPortRegistry, worktreeManager);
    this.queue = [...runs];
  }

  override async startAgent(_ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    return { agentId: "agt_usage", runId: `run_usage_${input.name.length}` };
  }

  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string,
  ): Promise<ExecuteRunResult> {
    const run = this.queue.shift();
    if (run == null) throw new Error(`${label}: no stubbed run result left`);
    const { agentId, runId } = await start();
    await this.support.persistRun(ctx.flow.id, nodeId, agentId, runId);
    if (run.result.status !== "finished") throw new Error(`${label} ended with status ${run.result.status}`);
    return { result: run.result, runRowId: `runrow_${runId}`, ...(run.usage ? { usage: run.usage } : {}) };
  }
}

describe("runUsagePayload (Task 21 — the artifact payload)", () => {
  it("maps the capture summary onto the payload, absent fields stay absent", () => {
    expect(runUsagePayload({
      durationMs: 1000, tokens: 42, costCents: 12, estimated: true, model: "m1",
      inputTokens: 100, outputTokens: 30, cacheReadTokens: 8, cacheWriteTokens: 4,
    })).toEqual({
      model: "m1", inputTokens: 100, outputTokens: 30, cacheReadTokens: 8, cacheWriteTokens: 4,
      costCents: 12, estimated: true, durationMs: 1000,
    });
    expect(runUsagePayload({ durationMs: 1000 })).toEqual({ durationMs: 1000 });
  });

  it("hasRunUsage is true only when a token or cost figure is present", () => {
    expect(hasRunUsage({ durationMs: 1000, model: "m1" })).toBe(false);
    expect(hasRunUsage({ durationMs: 1000, inputTokens: 1 })).toBe(true);
    expect(hasRunUsage({ durationMs: 1000, outputTokens: 1 })).toBe(true);
    expect(hasRunUsage({ durationMs: 1000, costCents: 0 })).toBe(true);
    expect(hasRunUsage({})).toBe(false);
  });
});

describe("Agent run usage → a `usage` artifact (Task 21 — Invariant F2)", () => {
  it("a run with usage persists ONE usage artifact carrying the token/cost/model fields", async () => {
    const flowId = "flw_usage_persists";
    const nodeId = await seedFlow(flowId);
    const node = new AgentTemplateNode(
      { id: "nt_usage", name: "Usage Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new UsageTestRunner({
          result: { status: "finished", result: "# Done" },
          usage: {
            model: "claude-sonnet-4",
            inputTokens: 1500, outputTokens: 300,
            cacheReadTokens: 800, cacheWriteTokens: 400,
            costCents: 12, estimated: true, durationMs: 42000, tokens: 1800,
          },
        }),
      },
    );

    await node.run(usageCtx(flowId), { prompt: "Do the work" }, {});

    const rows = await testAll<{ content: string; node_id: string; version: number }>(
      `SELECT content, node_id, version FROM artifacts WHERE flow_id=$1 AND kind='usage'`,
      flowId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.node_id).toBe(nodeId);
    expect(JSON.parse(rows[0]?.content ?? "{}")).toEqual({
      model: "claude-sonnet-4",
      inputTokens: 1500, outputTokens: 300,
      cacheReadTokens: 800, cacheWriteTokens: 400,
      costCents: 12, estimated: true, durationMs: 42000,
    });
  });

  it("a plan turn with usage persists ONE usage artifact on the plan node", async () => {
    const flowId = "flw_plan_usage";
    const nodeId = await seedFlow(flowId, { key: "plan", type: "plan" });
    const node = new PlanNode(
      nodeSupport,
      new UsageTestRunner({
        result: {
          status: "finished",
          result: JSON.stringify({
            reply: "Planned.",
            plan: {
              markdown: "# Plan",
              steps: [{ title: "Implement the fix", detail: "", files: [], branch: null }],
            },
          }),
        },
        usage: {
          model: "claude-sonnet-4",
          inputTokens: 900,
          outputTokens: 200,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
          costCents: 7,
          estimated: true,
          durationMs: 12000,
          tokens: 1100,
        },
      }),
    );

    await node.chat(usageCtx(flowId), "Plan the implementation");

    const rows = await testAll<{ content: string; node_id: string }>(
      `SELECT content, node_id FROM artifacts WHERE flow_id=$1 AND kind='usage'`,
      flowId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.node_id).toBe(nodeId);
    expect(JSON.parse(rows[0]?.content ?? "{}")).toEqual({
      model: "claude-sonnet-4",
      inputTokens: 900,
      outputTokens: 200,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      costCents: 7,
      estimated: true,
      durationMs: 12000,
    });
  });

  it("a second run adds its own artifact (per-run facts, no supersede collapse)", async () => {
    const flowId = "flw_usage_two_runs";
    await seedFlow(flowId);
    const node = new AgentTemplateNode(
      { id: "nt_usage2", name: "Usage Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new UsageTestRunner(
          { result: { status: "finished", result: "# One" }, usage: { model: "m1", inputTokens: 100, outputTokens: 10, costCents: 1 } },
          { result: { status: "finished", result: "# Two" }, usage: { model: "m1", inputTokens: 200, outputTokens: 20, costCents: 2 } },
        ),
      },
    );

    await node.run(usageCtx(flowId), { prompt: "First" }, {});
    // the terminal write moved the node to done — the engine re-claims it for
    // the retry, the seed puts it back the same way
    await testRun(`UPDATE nodes SET status='running' WHERE flow_id=$1`, flowId);
    await node.run(usageCtx(flowId), { prompt: "Second" }, {});

    const rows = await testAll<{ content: string }>(
      `SELECT content FROM artifacts WHERE flow_id=$1 AND kind='usage' ORDER BY version`,
      flowId,
    );
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]?.content ?? "{}").inputTokens).toBe(100);
    expect(JSON.parse(rows[1]?.content ?? "{}").inputTokens).toBe(200);
  });

  it("a run that reported no usage persists no artifact (the duration-only capture)", async () => {
    const flowId = "flw_usage_none";
    await seedFlow(flowId);
    const node = new AgentTemplateNode(
      { id: "nt_usage3", name: "Usage Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new UsageTestRunner({ result: { status: "finished", result: "# Done" } }),
      },
    );

    await node.run(usageCtx(flowId), { prompt: "Do the work" }, {});

    expect(await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='usage'`,
      flowId,
    )).toMatchObject({ count: 0n });
  });
});
