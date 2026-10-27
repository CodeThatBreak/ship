/**
 * T2 (node-definition refactor, phase 1): ONE persistence path for a finished
 * run. Restart recovery of an agent node must persist byte-identical
 * node/artifact/event rows as a normal `execute()` finish — only the
 * lifecycle event message carries the recovery note.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `../../../db` import touches the connection — dynamic
// imports below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-agent-recover-")),
  "test.db",
);

const { db } = await import("../../../db");
const { nodeSupport } = await import("../base/node-support");
const { flowCtxHelper } = await import("../base/flow-context");
const { usageTracker } = await import("../base/usage-tracker");
const { AgentRunner } = await import("../base/agent-runner");
const { AgentTemplateNode } = await import("./agent-node");
import type { Started } from "../base/agent-runner";
import type { AgentRunResult } from "../../ports/agent-runner";
import type { FlowCtx } from "../base";
import type { NodeRow } from "../../../db/rows";

const LABEL = "Test Agent";

/** executeRun stand-in with the real runner's persistence contract:
 * run row first, started/finished events, result back to the def. */
class StubRunner extends AgentRunner {
  constructor(private readonly result: AgentRunResult) {
    super(flowCtxHelper, nodeSupport, usageTracker);
  }
  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    _start: () => Promise<Started>,
    label: string,
  ): Promise<AgentRunResult> {
    this.support.persistRun(ctx.flow.id, nodeId, "agt_test", "run_test");
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} started (cloud)`);
    if (this.result.status !== "finished") {
      throw new Error(`${label} ended with status ${this.result.status}`);
    }
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} finished`);
    return this.result;
  }
}

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** One isolated flow + running agent node row (node_key = instance key). */
function seedAgentNode(index: number): { flowId: string; nodeId: string; ctx: FlowCtx } {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${index}`, "recover test", "open", "task", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId, taskId, `recover test ${index}`, "active", now(), now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    nodeId, flowId, `agent_${index}`, "agent", "running", now(), now(),
  );
  const ctx = {
    flow: { id: flowId, task_id: taskId, name: `recover test ${index}`, status: "active", execution_mode: "cloud", created_at: now(), updated_at: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "recover test", fields: {}, status: "open", issueType: "task", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, nodeId, ctx };
}

/** A template instance whose config output is markdown — the default contract. */
function agentNode(index: number, runner: AgentRunner): AgentTemplateNode {
  const node = new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config: {} },
    `agent_${index}`,
  );
  // F6: services are singleton field defaults until T1 — tests shadow them.
  (node as unknown as { runner: AgentRunner }).runner = runner;
  return node;
}

interface AppliedRows {
  node: { status: string; agent_id: string | null; output: string | null };
  artifact: { kind: string; content: string; meta: string | null; status: string } | undefined;
  finishEvent: { type: string; message: string; data: string | null } | undefined;
}

/** The persisted state a finish leaves behind (node row, latest artifact, the
 * "output ready" lifecycle event — the tail both execute() and recover() own). */
function appliedRows(flowId: string, nodeKey: string): AppliedRows {
  const nodeId = must(
    db.get<{ id: string }>(`SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey),
    `node ${nodeKey} of flow ${flowId}`,
  ).id;
  const node = must(
    db.get<{ status: string; agent_id: string | null; output: string | null }>(
      `SELECT status, agent_id, output FROM nodes WHERE id=?`, nodeId,
    ),
    `node row ${nodeId}`,
  );
  const artifact = db.get<{ kind: string; content: string; meta: string | null; status: string }>(
    `SELECT kind, content, meta, status FROM artifacts WHERE node_id=? ORDER BY version DESC LIMIT 1`, nodeId,
  );
  const events = db.all<{ type: string; message: string; data: string | null }>(
    `SELECT type, message, data FROM events WHERE node_id=? AND message LIKE '%output ready%'`, nodeId,
  );
  return { node, artifact, finishEvent: events.at(-1) };
}

const FINISHED_TEXT = "# Done\n\nThe work is complete.";

describe("AgentTemplateNode — one persistence path (T2)", () => {
  it("recover() persists byte-identical node/artifact rows as execute()'s finish", async () => {
    const result: AgentRunResult = { status: "finished", result: FINISHED_TEXT };
    const NOTE = "server restarted";

    // ── path A: a normal in-process finish (execute()) ──────────────────────
    const a = seedAgentNode(1);
    const nodeA = agentNode(1, new StubRunner(result));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    const executed = appliedRows(a.flowId, "agent_1");

    // ── path B: the same run finished while the server was down ────────────
    const b = seedAgentNode(2);
    const nodeB = agentNode(2, new StubRunner(result));
    const nodeRow = must(db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, b.nodeId), `node ${b.nodeId}`);
    nodeSupport.persistRun(b.flowId, b.nodeId, "agt_test", "run_orphan"); // the run row left by the dead process
    const recovered = await nodeB.recover(b.ctx, nodeRow, result, NOTE);
    expect(recovered).toBe(true);
    const recoveredRows = appliedRows(b.flowId, "agent_2");

    // byte-identical persistence (the only sanctioned difference: the note)
    expect(recoveredRows.node).toEqual(executed.node);
    expect(recoveredRows.node.status).toBe("done");
    expect(recoveredRows.node.agent_id).toBe("agt_test");
    expect(recoveredRows.node.output).toBe(JSON.stringify({ markdown: FINISHED_TEXT }));
    expect(recoveredRows.artifact).toEqual(executed.artifact);
    expect(recoveredRows.artifact?.kind).toBe("markdown");
    expect(recoveredRows.artifact?.content).toBe(FINISHED_TEXT);
    expect(recoveredRows.finishEvent).toEqual({
      type: "lifecycle",
      message: `${executed.finishEvent?.message} (${NOTE})`,
      data: executed.finishEvent?.data ?? null,
    });
    expect(executed.finishEvent?.message).toBe(`${LABEL} output ready`);
    expect(JSON.parse(recoveredRows.finishEvent?.data ?? "{}")).toEqual({ output_format: "markdown" });
  });

  it("a non-finished run declines recovery — the node fails for retry", async () => {
    const b = seedAgentNode(3);
    const nodeB = agentNode(3, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    const nodeRow = must(db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, b.nodeId), `node ${b.nodeId}`);
    const declined = await nodeB.recover(b.ctx, nodeRow, { status: "error" }, "server restarted");
    expect(declined).toBe(false);
    const node = must(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, b.nodeId), `node ${b.nodeId}`);
    expect(node.status).toBe("running"); // completeNodeFromResult owns the failing
  });

  it("a no-note applyOutcome (the execute() path) emits the bare event", async () => {
    const a = seedAgentNode(4);
    const nodeA = agentNode(4, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    const rows = appliedRows(a.flowId, "agent_4");
    expect(rows.finishEvent?.message).toBe(`${LABEL} output ready`);
  });
});
