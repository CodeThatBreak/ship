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

const { db } = await import("../../../../db");
const { nodeSupport } = await import("../../shared/node-support");
const { flowCtxHelper } = await import("../../shared/run-context");
const { usageTracker } = await import("../../../harness/usage-tracker");
const { AgentRunner } = await import("../../../harness/agent-runner");
const { AgentTemplateNode } = await import("./agent-node");
import type { Started, AgentStartInput, ExecuteRunResult } from "../../../harness/agent-runner";
import type { AgentRunResult } from "../../../ports/agent-port";
import type { FlowCtx } from "../../shared";
import type { NodeRow } from "../../../../db/rows";

const LABEL = "Test Agent";

/** executeRun stand-in with the real runner's persistence contract:
 * run row first, started/finished events, result back to the def. Accepts a
 * queue of results (one per executeRun) so contract-retry tests can stub the
 * first miss and the retry response, and records every start input so tests
 * can assert the feedback prompt. */
class StubRunner extends AgentRunner {
  private readonly queue: AgentRunResult[];
  /** The start inputs in call order. */
  readonly starts: AgentStartInput[] = [];

  constructor(...results: AgentRunResult[]) {
    super(flowCtxHelper, nodeSupport, usageTracker);
    this.queue = [...results];
  }

  override async startAgent(_ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    this.starts.push(input);
    return { agentId: "agt_test", runId: `run_${this.starts.length}` };
  }

  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string,
  ): Promise<ExecuteRunResult> {
    const result = this.queue.shift();
    if (result == null) throw new Error(`${label}: no stubbed run result left`);
    const { agentId, runId } = await start();
    this.support.persistRun(ctx.flow.id, nodeId, agentId, runId);
    const runRowId = db.get<{ id: string }>(`SELECT id FROM runs WHERE run_ref=?`, runId)?.id;
    if (!runRowId) throw new Error(`${label}: missing run row`);
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} started (cloud)`);
    if (result.status !== "finished") {
      throw new Error(`${label} ended with status ${result.status}`);
    }
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} finished`);
    return { result, runRowId };
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
function agentNode(index: number, runner: InstanceType<typeof AgentRunner>): InstanceType<typeof AgentTemplateNode> {
  // T1 (phase 2): services are constructor-injected — the test stub rides the
  // same seam production code uses, no field shadowing.
  return new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config: {} },
    `agent_${index}`,
    { runner },
  );
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

/** A template instance with a json output contract (schema on `cost`). */
const JSON_CONFIG = {
  output: "json",
  output_schema: { type: "object", properties: { cost: { type: "integer" } }, required: ["cost"] },
};

function jsonAgentNode(index: number, runner: InstanceType<typeof AgentRunner>): InstanceType<typeof AgentTemplateNode> {
  return new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config: JSON_CONFIG },
    `agent_${index}`,
    { runner },
  );
}

describe("AgentTemplateNode — the agent's self-report channel (json output)", () => {
  it("json output without an output_schema accepts any JSON object", async () => {
    const seeded = seedAgentNode(26);
    const cfg = { output: "json" as const, output_schema: null };
    const node = new AgentTemplateNode(
      { id: "nt_26", name: LABEL, description: null, config: cfg },
      "agent_26",
      { runner: new StubRunner({ status: "finished", result: '{"ok":true}' }) },
    );
    const outcome = await node.run(seeded.ctx, { prompt: "Go" }, cfg);
    expect(outcome.output).toEqual({ ok: true });
  });

  it("the json prompt rides the contract directive: schema + error envelope", async () => {
    const seeded = seedAgentNode(21);
    const node = jsonAgentNode(21, new StubRunner({ status: "finished", result: '{"cost":42}' }));
    const outcome = await node.run(seeded.ctx, { prompt: "Estimate the cost" }, JSON_CONFIG);
    expect(outcome.output).toEqual({ cost: 42 });

    const recorded = db.get<{ input: string }>(`SELECT input FROM nodes WHERE id=?`, seeded.nodeId)?.input;
    if (recorded == null) throw new Error("the node run recorded no input");
    expect(JSON.parse(recorded).prompt).toContain("exactly one JSON object");
    expect(JSON.parse(recorded).prompt).toContain('"type": "integer"');
    expect(JSON.parse(recorded).prompt).toContain('"output_error"');
  });

  it("an agent-self-reported envelope fails with the agent's own reason, not a validator message", async () => {
    const seeded = seedAgentNode(22);
    const runner = new StubRunner({
      status: "finished",
      result: JSON.stringify({
        output_error: { code: "missing_input", reason: "I was not given the invoice totals to validate" },
      }),
    });
    const node = jsonAgentNode(22, runner);
    await expect(node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG)).rejects.toMatchObject({
      code: "agent_reported",
      message: `${LABEL}: I was not given the invoice totals to validate`,
    });
    // a self-report never retries — the agent said it cannot comply; its
    // reason goes to the user (chat refinement), not back to the agent
    expect(runner.starts).toHaveLength(1);
  });

  it("a schema-violating response retries once with the violations as feedback, then succeeds", async () => {
    const seeded = seedAgentNode(24);
    const runner = new StubRunner(
      { status: "finished", result: '{"cost":"free"}' },
      { status: "finished", result: '{"cost":42}' },
    );
    const node = jsonAgentNode(24, runner);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG);
    expect(outcome.output).toEqual({ cost: 42 });

    // exactly one feedback turn, on the SAME agent session
    expect(runner.starts).toHaveLength(2);
    const feedback = runner.starts[1]?.prompt;
    if (feedback == null) throw new Error("the retry never started an agent");
    expect(feedback).toContain("violated the output contract");
    expect(feedback).toContain(`cost: ${LABEL} at cost must be of type integer (got string)`);
    expect(feedback).toContain('"output_error"'); // the full contract is re-stated
    expect(runner.starts[1]?.followUpOn).toBe("agt_test");

    // the trail shows the contract failure and the bounded retry
    const events = db.all<{ message: string }>(
      `SELECT message FROM events WHERE node_id=? AND type='lifecycle'`, seeded.nodeId,
    );
    expect(events.some((e) => e.message.includes("retrying with feedback"))).toBe(true);
  });

  it("a no-json response retries once too", async () => {
    const seeded = seedAgentNode(25);
    const runner = new StubRunner(
      { status: "finished", result: "I cannot answer in JSON, sorry" },
      { status: "finished", result: '{"cost":42}' },
    );
    const node = jsonAgentNode(25, runner);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG);
    expect(outcome.output).toEqual({ cost: 42 });
    expect(runner.starts[1]?.prompt).toContain("no JSON object could be parsed");
  });

  it("a second contract miss fails the node loudly — the retry is bounded", async () => {
    const seeded = seedAgentNode(23);
    const node = jsonAgentNode(
      23,
      new StubRunner(
        { status: "finished", result: '{"cost":"free"}' },
        { status: "finished", result: '{"cost":"still free"}' },
      ),
    );
    await expect(node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG)).rejects.toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL} at cost must be of type integer (got string)`,
    });
  });
});

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

  it("chat follow-up merges feedback into the recorded input without dropping inherited fields", async () => {
    const seeded = seedAgentNode(990);
    const inherited = { upstreamField: "from-parent", prompt: "initial" };
    db.run(`UPDATE nodes SET input=? WHERE id=?`, JSON.stringify(inherited), seeded.nodeId);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(990, runner);
    await node.chat(seeded.ctx, "tweak this", "model-x");
    const row = must(db.get<{ input: string }>(`SELECT input FROM nodes WHERE id=?`, seeded.nodeId), "node");
    const recorded = JSON.parse(row.input) as Record<string, unknown>;
    expect(recorded.upstreamField).toBe("from-parent");
    expect(recorded.feedback).toBe("tweak this");
    expect(recorded.model).toBe("model-x");
  });
});

// ── Phase 3: the agent node as a split SOURCE (agent-node split plan §7.3) ───

/** A json contract whose `services` array is the unit source, with the split
 *  selectors on non-default item paths (defaults are key / dependsOn). */
const SPLIT_CONFIG = {
  output: "json",
  output_schema: {
    type: "object",
    properties: {
      services: { type: "array", items: { type: "object" } },
    },
    required: ["services"],
  },
  split: {
    field: "services",
    key_field: "id",
    target: "build",
    target_field: "route",
    depends_on_field: "after",
  },
};

const SPLIT_OUTPUT = JSON.stringify({
  services: [
    { id: "api", title: "API service", after: ["db"], route: "nt_docs" },
    { id: "db" },
  ],
});

/** The malformed-units cases run against an UNCONSTRAINED output schema —
 *  the run persists the bad shape (nothing rejects it) and splitUnits owns
 *  the loud failure. */
const PERMISSIVE_SPLIT_CONFIG = {
  output: "json",
  output_schema: { type: "object" },
  split: SPLIT_CONFIG.split,
};

function splitAgentNode(
  index: number,
  runner: InstanceType<typeof AgentRunner>,
  config: Record<string, unknown> = SPLIT_CONFIG,
): InstanceType<typeof AgentTemplateNode> {
  return new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config },
    `agent_${index}`,
    { runner },
  );
}

describe("AgentTemplateNode — split units (the source port)", () => {
  it("no split declared → null units, and the prompt path is byte-identical (no directive)", async () => {
    // markdown: the whole path unchanged — the recorded prompt is the body, verbatim
    const a = seedAgentNode(31);
    const nodeA = agentNode(31, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    expect(nodeA.splitUnits(a.ctx)).toBeNull();
    const mdPrompt = db.get<{ input: string }>(`SELECT input FROM nodes WHERE id=?`, a.nodeId)?.input;
    expect(JSON.parse(mdPrompt ?? "{}").prompt).toBe("Do the work");

    // json: the contract directive rides, the split directive does not
    const b = seedAgentNode(32);
    const nodeB = jsonAgentNode(32, new StubRunner({ status: "finished", result: '{"cost":42}' }));
    await nodeB.run(b.ctx, { prompt: "Estimate the cost" }, JSON_CONFIG);
    expect(nodeB.splitUnits(b.ctx)).toBeNull();
    const jsonPrompt = db.get<{ input: string }>(`SELECT input FROM nodes WHERE id=?`, b.nodeId)?.input;
    expect(JSON.parse(jsonPrompt ?? "{}").prompt).toContain("RESPONSE FORMAT");
    expect(JSON.parse(jsonPrompt ?? "{}").prompt).not.toContain("UNIT OUTPUT");
  });

  it("no run output yet → null (nothing to iterate)", () => {
    const seeded = seedAgentNode(33);
    const node = splitAgentNode(33, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    expect(node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("an empty units array → null (no expansion)", async () => {
    const seeded = seedAgentNode(34);
    const node = splitAgentNode(34, new StubRunner({ status: "finished", result: '{"services":[]}' }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);
    expect(node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("the split field absent from the output → null (no expansion)", async () => {
    const seeded = seedAgentNode(35);
    const node = splitAgentNode(35, new StubRunner({ status: "finished", result: '{"cost":1}' }), PERMISSIVE_SPLIT_CONFIG);
    await node.run(seeded.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("maps key/title/dependsOn/target selectors, with the per-item target override", async () => {
    const seeded = seedAgentNode(36);
    const node = splitAgentNode(36, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);

    const units = node.splitUnits(seeded.ctx);
    if (units == null) throw new Error("splitUnits returned null for a non-empty array");
    expect(units).toHaveLength(2);
    // selectors on non-default paths; the item rides verbatim
    expect(units[0]).toEqual({
      key: "api",
      title: "API service",
      dependsOn: ["db"],
      target: "nt_docs", // per-item override beats the split default target
      item: { id: "api", title: "API service", after: ["db"], route: "nt_docs" },
    });
    // no title field → the key is the title; no deps → []; no override → the default target
    expect(units[1]).toEqual({
      key: "db",
      title: "db",
      dependsOn: [],
      target: "build",
      item: { id: "db" },
    });
  });

  it("the directive is appended after the output-contract directive, only when split is set", async () => {
    const seeded = seedAgentNode(37);
    const node = splitAgentNode(37, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);
    const recorded = db.get<{ input: string }>(`SELECT input FROM nodes WHERE id=?`, seeded.nodeId)?.input;
    if (recorded == null) throw new Error("the node run recorded no input");
    const prompt = JSON.parse(recorded).prompt as string;
    const contractAt = prompt.indexOf("RESPONSE FORMAT");
    const splitAt = prompt.indexOf("UNIT OUTPUT");
    expect(contractAt).toBeGreaterThanOrEqual(0);
    expect(splitAt).toBeGreaterThan(contractAt);
    // the static block names the configured selectors
    expect(prompt).toContain('"services" array are units of work');
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"after"');
  });

  it("a malformed units array fails loudly — the producer-error policy", async () => {
    // units not an array
    const a = seedAgentNode(38);
    const nodeA = splitAgentNode(38, new StubRunner({ status: "finished", result: '{"services":"oops"}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeA.run(a.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(splitUnitsErrorOf(nodeA, a.ctx)).toMatchObject({
      name: "AgentOutputError",
      code: "schema_mismatch",
      message: `${LABEL}: split field "services" must be an array of unit items (got string)`,
    });

    // an item that is not an object
    const b = seedAgentNode(39);
    const nodeB = splitAgentNode(39, new StubRunner({ status: "finished", result: '{"services":[1]}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeB.run(b.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(splitUnitsErrorOf(nodeB, b.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: split field "services" item 0 is not an object`,
    });

    // a missing unit key — the loud contract failure, never a silent skip
    const c = seedAgentNode(40);
    const nodeC = splitAgentNode(40, new StubRunner({ status: "finished", result: '{"services":[{"title":"no id"}]}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeC.run(c.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(splitUnitsErrorOf(nodeC, c.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: item 0 has no usable "id" — every unit needs a stable, non-empty key`,
    });

    // non-string[] dependencies
    const d = seedAgentNode(41);
    const nodeD = splitAgentNode(
      41,
      new StubRunner({ status: "finished", result: '{"services":[{"id":"api","after":"db"}]}' }),
      PERMISSIVE_SPLIT_CONFIG,
    );
    await nodeD.run(d.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(splitUnitsErrorOf(nodeD, d.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: item 0's "after" must be an array of unit keys`,
    });
  });
});

/** splitUnits fails synchronously (the port is sync) — capture the thrown
 *  producer error; a clean return is itself the failure. */
function splitUnitsErrorOf(node: InstanceType<typeof AgentTemplateNode>, ctx: FlowCtx): unknown {
  try {
    node.splitUnits(ctx);
  } catch (e: unknown) {
    return e;
  }
  throw new Error("expected splitUnits to fail loudly");
}
