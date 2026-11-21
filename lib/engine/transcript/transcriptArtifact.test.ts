import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { testAll, testGet, testRun } from "../../../tests/helpers/rawTestDb";
import type { Started, AgentStartInput, ExecuteRunResult } from "../harness/types/agentRunTypes";
import type { AgentRunResult } from "../ports/agentPort";
import type { FlowCtx } from "../nodes/shared/nodeSharedExports";
import { TOKEN_MASK } from "../agentTools/utils/toolsPromptBlock";
import { TRANSCRIPT_CALL_CAP } from "./constants/transcriptCaps";
import type { TranscriptPayload } from "./transcriptPayload";

// Must run before any `../../db` import touches the connection — dynamic
// imports below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../db/app");
beforeAll(resetTestDatabase);
const { AgentRunner } = await import("../harness/agentRunner/agentRunner");
const { AgentTemplateNode } = await import("../nodes/kinds/agent/agentTemplateNode");
const { flowCtxHelper } = await import("../nodes/shared/runContext");
const { nodeSupport } = await import("@/lib/composition/container");
const { usageTracker } = await import("../harness/usageTracker");
const { config } = await import("../../config");
const { agentPortRegistry } = await import("../ports/agentPort");
const { worktreeManager } = await import("../runtime/worktreeLifecycle");

const now = () => new Date().toISOString();

/** A task + flow (+ one node row for artifact writes); returns the node row id. */
const seedFlow = async (flowId: string): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    `BR-${flowId}`,
    "transcript artifact test",
    "open",
    "story",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId,
    taskId,
    "transcript artifact test",
    "active",
    now(),
    now(),
  );
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId,
    flowId,
    "agent_1",
    "agent",
    "running",
    now(),
    now(),
  );
  return nodeId;
};

/** A minimal FlowCtx over a seeded flow (the run path reads flow/task fields only). */
const transcriptCtx = (flowId: string): FlowCtx =>
  ({
    flow: { id: flowId, taskId: `task_${flowId}`, name: "transcript artifact test", status: "active", executionMode: "cloud", createdAt: now(), updatedAt: now() },
    task: { id: `task_${flowId}`, type: "generic", key: `BR-${flowId}`, summary: "transcript artifact test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  }) as unknown as FlowCtx;

/** executeRun stand-in (the factStore.test.ts pattern) whose result carries
 *  the captured transcript — the seam Task 22's artifact rides. */
class TranscriptTestRunner extends AgentRunner {
  private readonly queue: { result: AgentRunResult; transcript?: TranscriptPayload }[];

  constructor(...runs: { result: AgentRunResult; transcript?: TranscriptPayload }[]) {
    super(flowCtxHelper, nodeSupport, usageTracker, db, config, agentPortRegistry, worktreeManager);
    this.queue = [...runs];
  }

  override async startAgent(_ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    return { agentId: "agt_transcript", runId: `run_transcript_${input.name.length}` };
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
    return {
      result: run.result,
      runRowId: `runrow_${runId}`,
      ...(run.transcript ? { transcript: run.transcript } : {}),
    };
  }
}

describe("Agent run transcript → a `transcript` artifact (Task 22 — Invariant F2)", () => {
  it("a run with tool calls persists ONE transcript artifact listing the calls, token-redacted", async () => {
    const flowId = "flw_transcript_persists";
    const nodeId = await seedFlow(flowId);
    const node = new AgentTemplateNode(
      { id: "nt_transcript", name: "Transcript Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new TranscriptTestRunner({
          result: { status: "finished", result: "# Done" },
          transcript: {
            totalCalls: 3,
            truncated: false,
            calls: [
              { name: "Bash", status: "completed", durationMs: 1200, summary: '{"command":"npm test"}' },
              { name: "create_change_request", status: "failed", summary: `{"authorization":"Bearer ${TOKEN_MASK}","branch":"changelog/x"}` },
              { name: "read_flow_state", status: "completed" },
            ],
          },
        }),
      },
    );

    await node.run(transcriptCtx(flowId), { prompt: "Do the work" }, {});

    const rows = await testAll<{ content: string; node_id: string; version: number }>(
      `SELECT content, node_id, version FROM artifacts WHERE flow_id=$1 AND kind='transcript'`,
      flowId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.node_id).toBe(nodeId);
    const payload = JSON.parse(rows[0]?.content ?? "{}") as TranscriptPayload;
    expect(payload.totalCalls).toBe(3);
    expect(payload.truncated).toBe(false);
    expect(payload.calls.map((c) => c.name)).toEqual(["Bash", "create_change_request", "read_flow_state"]);
    // the redaction proof: the persisted artifact carries the mask, never the
    // capability token — no leaked value anywhere in the stored JSON
    expect(rows[0]?.content).toContain(TOKEN_MASK);
    expect(rows[0]?.content).not.toContain("tok_capability");
  });

  it("a run whose call log overflowed persists the capped list with the true count", async () => {
    const flowId = "flw_transcript_capped";
    await seedFlow(flowId);
    const overflow = TRANSCRIPT_CALL_CAP + 5;
    const node = new AgentTemplateNode(
      { id: "nt_transcript2", name: "Transcript Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new TranscriptTestRunner({
          result: { status: "finished", result: "# Done" },
          transcript: {
            totalCalls: overflow,
            truncated: true,
            calls: Array.from({ length: TRANSCRIPT_CALL_CAP }, (_, i) => ({ name: `tool_${i}`, status: "completed" })),
          },
        }),
      },
    );

    await node.run(transcriptCtx(flowId), { prompt: "Do the work" }, {});

    const payload = JSON.parse(
      (await testGet<{ content: string }>(`SELECT content FROM artifacts WHERE flow_id=$1 AND kind='transcript'`, flowId))?.content ?? "{}",
    ) as TranscriptPayload;
    expect(payload.calls).toHaveLength(TRANSCRIPT_CALL_CAP);
    expect(payload.totalCalls).toBe(overflow);
    expect(payload.truncated).toBe(true);
  });

  it("a run that made no tool calls persists no artifact", async () => {
    const flowId = "flw_transcript_none";
    await seedFlow(flowId);
    const node = new AgentTemplateNode(
      { id: "nt_transcript3", name: "Transcript Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new TranscriptTestRunner({ result: { status: "finished", result: "# Done" } }),
      },
    );

    await node.run(transcriptCtx(flowId), { prompt: "Do the work" }, {});

    expect(await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='transcript'`,
      flowId,
    )).toMatchObject({ count: 0n });
  });
});
