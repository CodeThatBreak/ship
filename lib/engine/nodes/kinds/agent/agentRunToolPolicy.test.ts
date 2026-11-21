/**
 * Task 16 (design C2): the recorded effective tool/MCP policy. The recorded
 * input blob carries the effective tool set (`agentTools()` ∩ declared) and
 * the ambient setting layers the mode adapter actually applied — a cloud run
 * records its fixed ambient layers and that the local-only `mcp_sources` knob
 * was dropped by policy; a local run records the layers it loads.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";

// Must run before any `../../../db` import touches the connection — dynamic
// imports below execute in statement order after the static ones hoist.

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

beforeAll(resetTestDatabase);

const { db } = await import("../../../../db/app");
const { nodeSupport } = await import("@/lib/composition/container");
const { flowCtxHelper } = await import("../../shared/runContext");
const { usageTracker } = await import("../../../harness/usageTracker");
const { AgentRunner } = await import("../../../harness/agentRunner/agentRunner");
const { config } = await import("../../../../config");
const { agentPortRegistry } = await import("../../../ports/agentPort");
const { worktreeManager } = await import("../../../runtime/worktreeLifecycle");
const { AgentTemplateNode } = await import("./agentTemplateNode");
const { recordedRunToolPolicy } = await import("../../shared/runToolPolicy");
const { CLOUD_AMBIENT_SETTING_SOURCES, TOOL_POLICY_INPUT_KEY } = await import(
  "../../../constants/agentRunPolicy"
);
import type { Started, ExecuteRunResult } from "../../../harness/types/agentRunTypes";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { RecordedToolPolicy } from "../../../constants/agentRunPolicy";

const LABEL = "Policy Agent";

/** executeRun stand-in with the real runner's persistence contract
 * (agentTemplateNode.test.ts's StubRunner, trimmed to the policy's needs). */
class StubRunner extends AgentRunner {
  constructor(private readonly result: AgentRunResult) {
    super(flowCtxHelper, nodeSupport, usageTracker, db, config, agentPortRegistry, worktreeManager);
  }

  override async startAgent(): Promise<Started> {
    return { agentId: "agt_policy", runId: "run_policy" };
  }

  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string,
  ): Promise<ExecuteRunResult> {
    const { agentId, runId } = await start();
    await this.support.persistRun(ctx.flow.id, nodeId, agentId, runId);
    const runRowId = (await testGet<{ id: string }>(`SELECT id FROM runs WHERE run_ref=$1`, runId))?.id;
    if (!runRowId) throw new Error(`${label}: missing run row`);
    if (this.result.status !== "finished") throw new Error(`${label} ended with status ${this.result.status}`);
    // no usage captured — the stubbed runs attach none (Task 21's optional side-channel)
    return { result: this.result, runRowId, usage: {} };
  }
}

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** One isolated flow + running agent node row (node_key = instance key). */
async function seedAgentNode(index: number, executionMode: "cloud" | "local"): Promise<{ nodeId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "tool policy", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId, taskId, `tool policy ${index}`, "active", executionMode, now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, `agent_${index}`, "agent", "running", now(), now(),
  );
  const ctx = {
    flow: { id: flowId, taskId, name: `tool policy ${index}`, status: "active", executionMode, createdAt: now(), updatedAt: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "tool policy", fields: {}, status: "open", issueType: "task", priority: "P2" },
  } as unknown as FlowCtx;
  return { nodeId, ctx };
}

/** A template instance whose def declares the given knobs. */
function agentNode(index: number, cfg: Record<string, unknown>): InstanceType<typeof AgentTemplateNode> {
  return new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config: cfg },
    `agent_${index}`,
    { runner: new StubRunner({ status: "finished", result: "# Done" }) },
  );
}

/** The policy blob the run recorded into the node's recorded-input JSON. */
async function recordedPolicy(nodeId: string): Promise<RecordedToolPolicy> {
  const row = must(
    await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, nodeId),
    `node row ${nodeId}`,
  );
  const recorded = row.input;
  if (recorded == null) throw new Error("the run recorded no input blob");
  const policy = recorded[TOOL_POLICY_INPUT_KEY];
  if (policy == null || typeof policy !== "object") {
    throw new Error("the run recorded no tool policy");
  }
  return policy as RecordedToolPolicy;
}

describe("recordedRunToolPolicy (pure)", () => {
  it("a cloud run records its fixed ambient layers and the policy drop", () => {
    const policy = recordedRunToolPolicy({
      execMode: "cloud",
      requested: ["project", "user"],
      tools: ["read_flow_state", "report_failure"],
    });
    expect(policy).toEqual({
      tools: ["read_flow_state", "report_failure"],
      settingSources: [...CLOUD_AMBIENT_SETTING_SOURCES],
      settingSourcesDropped: true,
    });
  });

  it("a cloud run with no requested sources records the ambient layers, no drop", () => {
    const policy = recordedRunToolPolicy({ execMode: "cloud", requested: undefined, tools: [] });
    expect(policy.settingSources).toEqual([...CLOUD_AMBIENT_SETTING_SOURCES]);
    expect(policy.settingSourcesDropped).toBe(false);
  });

  it("a local run records the layers the adapter forwards", () => {
    const policy = recordedRunToolPolicy({ execMode: "local", requested: ["project", "plugins"], tools: [] });
    expect(policy.settingSources).toEqual(["project", "plugins"]);
    expect(policy.settingSourcesDropped).toBe(false);
  });

  it("a local run with no requested sources records the SDK default (empty)", () => {
    const policy = recordedRunToolPolicy({ execMode: "local", requested: [], tools: [] });
    expect(policy.settingSources).toEqual([]);
    expect(policy.settingSourcesDropped).toBe(false);
  });
});

describe("AgentRunNode — the recorded tool/MCP policy (task 16, C2)", () => {
  it("a cloud run records the ambient layers it used and the settingSources drop", async () => {
    const seeded = await seedAgentNode(1, "cloud");
    const cfg = {
      mcp_sources: ["project", "plugins"],
      agent_tools: ["read_flow_state", "create_change_request"],
    };
    await agentNode(1, cfg).run(seeded.ctx, { prompt: "Do the work" }, cfg);
    expect(await recordedPolicy(seeded.nodeId)).toEqual({
      tools: ["read_flow_state", "create_change_request"],
      settingSources: [...CLOUD_AMBIENT_SETTING_SOURCES],
      settingSourcesDropped: true,
    });
  });

  it("a local run records the layers it loaded — nothing dropped", async () => {
    const seeded = await seedAgentNode(2, "local");
    const cfg = { mcp_sources: ["project", "user"] };
    await agentNode(2, cfg).run(seeded.ctx, { prompt: "Do the work" }, cfg);
    expect(await recordedPolicy(seeded.nodeId)).toEqual({
      tools: ["read_flow_state", "report_failure"],
      settingSources: ["project", "user"],
      settingSourcesDropped: false,
    });
  });

  it("a run without the knobs records the kind defaults — tools ∩ declared, no requested sources", async () => {
    const seeded = await seedAgentNode(3, "cloud");
    await agentNode(3, {}).run(seeded.ctx, { prompt: "Do the work" }, {});
    expect(await recordedPolicy(seeded.nodeId)).toEqual({
      tools: ["read_flow_state", "report_failure"],
      settingSources: [...CLOUD_AMBIENT_SETTING_SOURCES],
      settingSourcesDropped: false,
    });
  });
});
