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
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Must run before any `../../../db` import touches the connection — dynamic
// imports below execute in statement order after the static ones hoist.

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../../db/app");

beforeAll(resetTestDatabase);
const { nodeSupport } = await import("@/lib/composition/container");
const { flowCtxHelper } = await import("../../shared/runContext");
const { usageTracker } = await import("../../../harness/usageTracker");
const { AgentRunner } = await import("../../../harness/agentRunner/agentRunner");
const { config } = await import("../../../../config");
const { agentPortRegistry } = await import("../../../ports/agentPort");
const { worktreeManager } = await import("../../../runtime/worktreeLifecycle");
const { FlowContextHelper } = await import("../../shared/runContext/flowContextHelper");
const { localGit } = await import("../../../../git/local");
const { RUN_MODE } = await import("@/constants/execution");
const { AgentTemplateNode } = await import("./agentTemplateNode");
import type { Started, AgentStartInput, ExecuteRunResult } from "../../../harness/types/agentRunTypes";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { FlowCtx } from "../../shared/nodeSharedExports";
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
    super(flowCtxHelper, nodeSupport, usageTracker, db, config, agentPortRegistry, worktreeManager);
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
    await this.support.persistRun(ctx.flow.id, nodeId, agentId, runId);
    const runRowId = (await testGet<{ id: string }>(`SELECT id FROM runs WHERE run_ref=$1`, runId))?.id;
    if (!runRowId) throw new Error(`${label}: missing run row`);
    await db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} started (cloud)`);
    if (result.status !== "finished") {
      throw new Error(`${label} ended with status ${result.status}`);
    }
    await db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} finished`);
    // the real runner always returns the cost summary object (possibly empty —
    // Task 21's usage side-channel reads it off the result)
    return { result, runRowId, usage: {} };
  }
}

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** One isolated flow + running agent node row (node_key = instance key). */
async function seedAgentNode(index: number): Promise<{ flowId: string; nodeId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "recover test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId, taskId, `recover test ${index}`, "active", now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, `agent_${index}`, "agent", "running", now(), now(),
  );
  const ctx = {
    flow: { id: flowId, taskId, name: `recover test ${index}`, status: "active", executionMode: "cloud", createdAt: now(), updatedAt: now() },
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
async function appliedRows(flowId: string, nodeKey: string): Promise<AppliedRows> {
  const nodeId = must(
    await testGet<{ id: string }>(`SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey),
    `node ${nodeKey} of flow ${flowId}`,
  ).id;
  const node = must(
    await testGet<{ status: string; agent_id: string | null; output: string | null }>(
      `SELECT status, agent_id, output FROM nodes WHERE id=$1`, nodeId,
    ),
    `node row ${nodeId}`,
  );
  const artifact = await testGet<{ kind: string; content: string; meta: string | null; status: string }>(
    `SELECT kind, content, meta, status FROM artifacts WHERE node_id=$1 ORDER BY version DESC LIMIT 1`, nodeId,
  );
  const events = await testAll<{ type: string; message: string; data: string | null }>(
    `SELECT type, message, data FROM events WHERE node_id=$1 AND message LIKE '%output ready%'`, nodeId,
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
    const seeded = await seedAgentNode(26);
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
    const seeded = await seedAgentNode(21);
    const node = jsonAgentNode(21, new StubRunner({ status: "finished", result: '{"cost":42}' }));
    const outcome = await node.run(seeded.ctx, { prompt: "Estimate the cost" }, JSON_CONFIG);
    expect(outcome.output).toEqual({ cost: 42 });

    const recorded = (await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, seeded.nodeId))?.input;
    if (recorded == null) throw new Error("the node run recorded no input");
    const recordedPrompt = recorded.prompt as string;
    expect(recordedPrompt).toContain("exactly one JSON object");
    expect(recordedPrompt).toContain('"type": "integer"');
    expect(recordedPrompt).toContain('"output_error"');
  });

  it("an agent-self-reported envelope fails with the agent's own reason, not a validator message", async () => {
    const seeded = await seedAgentNode(22);
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
    const seeded = await seedAgentNode(24);
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
    // the issue wording is the Zod contract's now (step 04) — not the lite
    // validator's "must be of type" phrasing
    expect(feedback).toContain("cost: Invalid input: expected number, received string");
    expect(feedback).toContain('"output_error"'); // the full contract is re-stated
    expect(runner.starts[1]?.followUpOn).toBe("agt_test");

    // the trail shows the contract failure and the bounded retry — the
    // pipeline's typed `output_retry` event (step 05)
    const events = await testAll<{ message: string }>(
      `SELECT message FROM events WHERE node_id=$1 AND type='output_retry'`, seeded.nodeId,
    );
    expect(events.some((e) => e.message.includes("retrying with feedback"))).toBe(true);
  });

  it("a no-json response retries once too", async () => {
    const seeded = await seedAgentNode(25);
    const runner = new StubRunner(
      { status: "finished", result: "I cannot answer in JSON, sorry" },
      { status: "finished", result: '{"cost":42}' },
    );
    const node = jsonAgentNode(25, runner);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG);
    expect(outcome.output).toEqual({ cost: 42 });
    expect(runner.starts[1]?.prompt).toContain("no JSON object could be parsed");
  });

  it("a second contract miss fails the node with the failed_output artifact — the retry is bounded (Task 20)", async () => {
    const seeded = await seedAgentNode(23);
    const runner = new StubRunner(
      { status: "finished", result: '{"cost":"free"}' },
      { status: "finished", result: '{"cost":"still free"}' },
    );
    const node = jsonAgentNode(23, runner);
    // the exhaustion is a terminal failed outcome — not a throw (Task 20)
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, JSON_CONFIG);
    expect(outcome.status).toBe("failed");
    expect(runner.starts).toHaveLength(2);
    const rows = await appliedRows(seeded.flowId, "agent_23");
    expect(rows.node.status).toBe("failed");
    expect(rows.artifact?.kind).toBe("failed_output");
  });
});

describe("AgentTemplateNode — one persistence path (T2)", () => {
  it("recover() persists byte-identical node/artifact rows as execute()'s finish", async () => {
    const result: AgentRunResult = { status: "finished", result: FINISHED_TEXT };
    const NOTE = "server restarted";

    // ── path A: a normal in-process finish (execute()) ──────────────────────
    const a = await seedAgentNode(1);
    const nodeA = agentNode(1, new StubRunner(result));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    const executed = await appliedRows(a.flowId, "agent_1");

    // ── path B: the same run finished while the server was down ────────────
    const b = await seedAgentNode(2);
    const nodeB = agentNode(2, new StubRunner(result));
    const nodeRow = must(await testGet<NodeRow>(`SELECT * FROM nodes WHERE id=$1`, b.nodeId), `node ${b.nodeId}`);
    await nodeSupport.persistRun(b.flowId, b.nodeId, "agt_test", "run_orphan"); // the run row left by the dead process
    const recovered = await nodeB.recover(b.ctx, nodeRow, result, NOTE);
    expect(recovered).toEqual({ kind: "recovered" });
    const recoveredRows = await appliedRows(b.flowId, "agent_2");

    // byte-identical persistence (the only sanctioned difference: the note)
    expect(recoveredRows.node).toEqual(executed.node);
    expect(recoveredRows.node.status).toBe("done");
    expect(recoveredRows.node.agent_id).toBe("agt_test");
    expect(recoveredRows.node.output).toEqual({ markdown: FINISHED_TEXT });
    expect(recoveredRows.artifact).toEqual(executed.artifact);
    expect(recoveredRows.artifact?.kind).toBe("markdown");
    expect(recoveredRows.artifact?.content).toBe(FINISHED_TEXT);
    expect(recoveredRows.finishEvent).toEqual({
      type: "lifecycle",
      message: `${executed.finishEvent?.message} (${NOTE})`,
      data: executed.finishEvent?.data ?? null,
    });
    expect(executed.finishEvent?.message).toBe(`${LABEL} output ready`);
    expect(recoveredRows.finishEvent?.data).toEqual({ output_format: "markdown" });
  });

  it("a non-finished run declines recovery — the node fails for retry", async () => {
    const b = await seedAgentNode(3);
    const nodeB = agentNode(3, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    const nodeRow = must(await testGet<NodeRow>(`SELECT * FROM nodes WHERE id=$1`, b.nodeId), `node ${b.nodeId}`);
    const declined = await nodeB.recover(b.ctx, nodeRow, { status: "error" }, "server restarted");
    expect(declined).toMatchObject({ kind: "manual" });
    const node = must(await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, b.nodeId), `node ${b.nodeId}`);
    expect(node.status).toBe("running"); // completeNodeFromResult owns the failing
  });

  it("a no-note applyOutcome (the execute() path) emits the bare event", async () => {
    const a = await seedAgentNode(4);
    const nodeA = agentNode(4, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    const rows = await appliedRows(a.flowId, "agent_4");
    expect(rows.finishEvent?.message).toBe(`${LABEL} output ready`);
  });

  it("chat follow-up merges feedback into the recorded input without dropping inherited fields", async () => {
    const seeded = await seedAgentNode(990);
    const inherited = { upstreamField: "from-parent", prompt: "initial" };
    await testRun(`UPDATE nodes SET input=$1 WHERE id=$2`, JSON.stringify(inherited), seeded.nodeId);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(990, runner);
    await node.chat(seeded.ctx, "tweak this", "model-x");
    const row = must(await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, seeded.nodeId), "node");
    const recorded = row.input as Record<string, unknown>;
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
    const a = await seedAgentNode(31);
    const nodeA = agentNode(31, new StubRunner({ status: "finished", result: FINISHED_TEXT }));
    await nodeA.run(a.ctx, { prompt: "Do the work" }, {});
    expect(await nodeA.splitUnits(a.ctx)).toBeNull();
    const mdPrompt = (await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, a.nodeId))?.input;
    expect((mdPrompt ?? {}) as Record<string, unknown>).toMatchObject({ prompt: "Do the work" });

    // json: the contract directive rides, the split directive does not
    const b = await seedAgentNode(32);
    const nodeB = jsonAgentNode(32, new StubRunner({ status: "finished", result: '{"cost":42}' }));
    await nodeB.run(b.ctx, { prompt: "Estimate the cost" }, JSON_CONFIG);
    expect(await nodeB.splitUnits(b.ctx)).toBeNull();
    const jsonPrompt = ((await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, b.nodeId))?.input ?? {}) as Record<string, unknown>;
    expect(jsonPrompt.prompt as string).toContain("RESPONSE FORMAT");
    expect(jsonPrompt.prompt as string).not.toContain("UNIT OUTPUT");
  });

  it("no run output yet → null (nothing to iterate)", async () => {
    const seeded = await seedAgentNode(33);
    const node = splitAgentNode(33, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    expect(await node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("an empty units array → null (no expansion)", async () => {
    const seeded = await seedAgentNode(34);
    const node = splitAgentNode(34, new StubRunner({ status: "finished", result: '{"services":[]}' }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);
    expect(await node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("the split field absent from the output → null (no expansion)", async () => {
    const seeded = await seedAgentNode(35);
    const node = splitAgentNode(35, new StubRunner({ status: "finished", result: '{"cost":1}' }), PERMISSIVE_SPLIT_CONFIG);
    await node.run(seeded.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(await node.splitUnits(seeded.ctx)).toBeNull();
  });

  it("maps key/title/dependsOn/target selectors, with the per-item target override", async () => {
    const seeded = await seedAgentNode(36);
    const node = splitAgentNode(36, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);

    const units = await node.splitUnits(seeded.ctx);
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
    const seeded = await seedAgentNode(37);
    const node = splitAgentNode(37, new StubRunner({ status: "finished", result: SPLIT_OUTPUT }));
    await node.run(seeded.ctx, { prompt: "List the services" }, SPLIT_CONFIG);
    const recorded = (await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, seeded.nodeId))?.input;
    if (recorded == null) throw new Error("the node run recorded no input");
    const prompt = recorded.prompt as string;
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
    const a = await seedAgentNode(38);
    const nodeA = splitAgentNode(38, new StubRunner({ status: "finished", result: '{"services":"oops"}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeA.run(a.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(await splitUnitsErrorOf(nodeA, a.ctx)).toMatchObject({
      name: "AgentOutputError",
      code: "schema_mismatch",
      message: `${LABEL}: split field "services" must be an array of unit items (got string)`,
    });

    // an item that is not an object
    const b = await seedAgentNode(39);
    const nodeB = splitAgentNode(39, new StubRunner({ status: "finished", result: '{"services":[1]}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeB.run(b.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(await splitUnitsErrorOf(nodeB, b.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: split field "services" item 0 is not an object`,
    });

    // a missing unit key — the loud contract failure, never a silent skip
    const c = await seedAgentNode(40);
    const nodeC = splitAgentNode(40, new StubRunner({ status: "finished", result: '{"services":[{"title":"no id"}]}' }), PERMISSIVE_SPLIT_CONFIG);
    await nodeC.run(c.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(await splitUnitsErrorOf(nodeC, c.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: item 0 has no usable "id" — every unit needs a stable, non-empty key`,
    });

    // non-string[] dependencies
    const d = await seedAgentNode(41);
    const nodeD = splitAgentNode(
      41,
      new StubRunner({ status: "finished", result: '{"services":[{"id":"api","after":"db"}]}' }),
      PERMISSIVE_SPLIT_CONFIG,
    );
    await nodeD.run(d.ctx, { prompt: "List the services" }, PERMISSIVE_SPLIT_CONFIG);
    expect(await splitUnitsErrorOf(nodeD, d.ctx)).toMatchObject({
      code: "schema_mismatch",
      message: `${LABEL}: item 0's "after" must be an array of unit keys`,
    });
  });
});

/** splitUnits rejects with the producer error — capture it; a clean
 *  (non-throwing) return is itself the failure. */
async function splitUnitsErrorOf(node: InstanceType<typeof AgentTemplateNode>, ctx: FlowCtx): Promise<unknown> {
  try {
    await node.splitUnits(ctx);
  } catch (e: unknown) {
    return e;
  }
  throw new Error("expected splitUnits to fail loudly");
}

// ── Task 03: the `base_ref` + `retry_budget` knobs ───────────────────────────

/** A template instance whose config overrides come straight from the test. */
function configuredAgentNode(
  index: number,
  runner: InstanceType<typeof AgentRunner>,
  config: Record<string, unknown>,
): InstanceType<typeof AgentTemplateNode> {
  return new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config },
    `agent_${index}`,
    { runner },
  );
}

/** The seeded ctx, with the flow's MR branch set (the base_ref fallback). */
const ctxWithMrBranch = (seeded: { ctx: FlowCtx }, mrBranch: string): FlowCtx =>
  ({ ...seeded.ctx, flow: { ...seeded.ctx.flow, mrBranch } }) as unknown as FlowCtx;

describe("AgentTemplateNode — base_ref + retry_budget (Task 03)", () => {
  it("a declared base_ref starts the run from that ref", async () => {
    const seeded = await seedAgentNode(51);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(51, runner);
    await node.run(seeded.ctx, { prompt: "Do the work" }, { base_ref: "develop" });
    expect(runner.starts[0]?.startingRef).toBe("develop");
  });

  it("a {{...}} base_ref renders against the flow context at run time", async () => {
    const seeded = await seedAgentNode(52);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(52, runner);
    await node.run(seeded.ctx, { prompt: "Do the work" }, { base_ref: "{{task.key}}" });
    expect(runner.starts[0]?.startingRef).toBe("TST-52");
  });

  it("a null base_ref falls back to the flow's MR branch", async () => {
    const seeded = await seedAgentNode(53);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(53, runner);
    await node.run(ctxWithMrBranch(seeded, "feature/x"), { prompt: "Do the work" }, {});
    expect(runner.starts[0]?.startingRef).toBe("feature/x");
  });

  it("a flow without an MR branch starts undefined (the runner's default)", async () => {
    const seeded = await seedAgentNode(58); // the seeded ctx carries no mrBranch
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(58, runner);
    await node.run(seeded.ctx, { prompt: "Do the work" }, {});
    expect(runner.starts[0]?.startingRef).toBeUndefined();
  });

  it("the chat follow-up starts from the same declared ref", async () => {
    const seeded = await seedAgentNode(54);
    const runner = new StubRunner(
      { status: "finished", result: FINISHED_TEXT },
      { status: "finished", result: FINISHED_TEXT },
    );
    const node = agentNode(54, runner);
    const cfg = { base_ref: "develop" };
    await node.run(seeded.ctx, { prompt: "Do the work" }, cfg);
    // the follow-up reads the node row's config snapshot — persist the knob,
    // and put the row back in `running` (execute owns the done transition)
    await testRun(`UPDATE nodes SET config=$1, status='running' WHERE id=$2`, JSON.stringify(cfg), seeded.nodeId);
    await node.chat(seeded.ctx, "tweak this", "model-x");
    expect(runner.starts[0]?.startingRef).toBe("develop");
    expect(runner.starts[1]?.startingRef).toBe("develop");
  });

  it("the contract feedback retry passes the SAME startingRef as the first run (E2)", async () => {
    const seeded = await seedAgentNode(55);
    const runner = new StubRunner(
      { status: "finished", result: '{"cost":"free"}' },
      { status: "finished", result: '{"cost":42}' },
    );
    const config = { ...JSON_CONFIG, base_ref: "develop" };
    const node = configuredAgentNode(55, runner, config);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, config);
    expect(outcome.output).toEqual({ cost: 42 });
    expect(runner.starts[0]?.startingRef).toBe("develop");
    expect(runner.starts[1]?.startingRef).toBe("develop");
  });

  it("retry_budget: 2 spends two retries then fails with output_exhausted and the failed_output artifact", async () => {
    const seeded = await seedAgentNode(56);
    const runner = new StubRunner(
      { status: "finished", result: '{"cost":"free"}' },
      { status: "finished", result: '{"cost":"still free"}' },
      { status: "finished", result: '{"cost":"forever free"}' },
    );
    const config = { ...JSON_CONFIG, retry_budget: 2 };
    const node = configuredAgentNode(56, runner, config);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, config);
    expect(runner.starts).toHaveLength(3);
    const exhausted = await testAll<{ message: string; data: unknown }>(
      `SELECT message, data FROM events WHERE node_id=$1 AND type='output_exhausted'`, seeded.nodeId,
    );
    expect(exhausted).toHaveLength(1);
    const raw = exhausted[0]?.data;
    const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as { budget?: number };
    expect(data.budget).toBe(2);

    // Task 20: the failed terminal rides the one persistence path — the node
    // row, the artifact (raw head + violations) and the lifecycle event land
    // in the same batch (Invariant F2)
    expect(outcome.status).toBe("failed");
    const nodeRow = must(
      await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, seeded.nodeId),
      `node row ${seeded.nodeId}`,
    );
    expect(nodeRow.status).toBe("failed");
    const artifact = must(
      await testGet<{ kind: string; content: string; meta: string | null }>(
        `SELECT kind, content, meta FROM artifacts WHERE node_id=$1 AND kind='failed_output' ORDER BY version DESC LIMIT 1`,
        seeded.nodeId,
      ),
      "the failed_output artifact",
    );
    expect(artifact.content).toBe('{"cost":"forever free"}');
    const meta = (typeof artifact.meta === "string" ? JSON.parse(artifact.meta) : artifact.meta) as {
      code?: string;
      budget?: number;
      issues?: { path: string; message: string }[];
    };
    expect(meta.code).toBe("schema_mismatch");
    expect(meta.budget).toBe(2);
    expect(meta.issues).toEqual([
      { path: "cost", message: "Invalid input: expected number, received string" },
    ]);
  });

  it("retry_budget: 0 makes the first miss terminal — no feedback turn", async () => {
    const seeded = await seedAgentNode(57);
    const runner = new StubRunner({ status: "finished", result: '{"cost":"free"}' });
    const config = { ...JSON_CONFIG, retry_budget: 0 };
    const node = configuredAgentNode(57, runner, config);
    const outcome = await node.run(seeded.ctx, { prompt: "Check the costs" }, config);
    expect(outcome.status).toBe("failed");
    expect(runner.starts).toHaveLength(1);
    const rows = await appliedRows(seeded.flowId, "agent_57");
    expect(rows.artifact?.kind).toBe("failed_output");
  });
});

// ── Task 07: result.git → facts in finalizeOutput ─────────────────────────────

/** A ctxHelper whose makeDiff records every capture and returns a fixed
 *  payload — the real one is git I/O and the test flow has no repo.
 *  `failCapture` makes the capture fail (null) like the real git path can. */
class DiffStubCtxHelper extends FlowContextHelper {
  readonly captured: string[] = [];
  readonly cwdReads: string[] = [];
  failCapture = false;
  localMode = false;
  override execMode(): ReturnType<InstanceType<typeof FlowContextHelper>["execMode"]> {
    return this.localMode ? RUN_MODE.LOCAL : RUN_MODE.CLOUD;
  }
  override requireRunCwd(): string {
    this.cwdReads.push("/test/worktree");
    return "/test/worktree";
  }
  override async makeDiff(_ctx: FlowCtx, branch: string): Promise<{ files: never[]; stat: string; raw: string } | null> {
    this.captured.push(branch);
    if (this.failCapture) return null;
    return { files: [], stat: `1 file changed (${branch})`, raw: `diff ${branch}` };
  }
}

/** A producing agent node whose run self-reports the given git branches. */
const producingAgentNode = (
  index: number,
  ctxHelper: DiffStubCtxHelper,
  gitBranches: string[],
): InstanceType<typeof AgentTemplateNode> =>
  new AgentTemplateNode(
    { id: `nt_${index}`, name: LABEL, description: null, config: {} },
    `agent_${index}`,
    {
      runner: new StubRunner({
        status: "finished",
        result: FINISHED_TEXT,
        git: { branches: gitBranches.map((branch) => ({ branch })) },
      }),
      ctxHelper,
    },
  );

/** The flow's branch rows (the branch-fact home). */
const branchRowsOf = async (flowId: string): Promise<{ name: string; status: string; git_branch: string | null }[]> =>
  testAll<{ name: string; status: string; git_branch: string | null }>(
    `SELECT name, status::text AS status, git_branch FROM branches WHERE flow_id=$1 ORDER BY name`,
    flowId,
  );

/** The flow's diff facts (kind:"diff" artifacts with the meta {branch, stat} shape). */
const diffArtifactsOf = async (flowId: string): Promise<{ branch: string | null; stat: string | null }[]> =>
  testAll<{ branch: string | null; stat: string | null }>(
    `SELECT meta->>'branch' AS branch, meta->>'stat' AS stat FROM artifacts WHERE flow_id=$1 AND kind='diff' ORDER BY branch`,
    flowId,
  );

describe("AgentTemplateNode — result.git → facts (Task 07)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a run with produces [branch,diff] persists one branch row + one diff artifact per reported branch", async () => {
    const seeded = await seedAgentNode(61);
    const ctxHelper = new DiffStubCtxHelper();
    const node = producingAgentNode(61, ctxHelper, ["changelog/x", "docs/y"]);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    const rows = await branchRowsOf(seeded.flowId);
    expect(rows.map((r) => r.name)).toEqual(["changelog/x", "docs/y"]);
    expect(rows.every((r) => r.status === "building" && r.git_branch === r.name)).toBe(true);
    const diffs = await diffArtifactsOf(seeded.flowId);
    expect(diffs.map((d) => d.branch)).toEqual(["changelog/x", "docs/y"]);
    expect(diffs.every((d) => d.stat === `1 file changed (${d.branch})`)).toBe(true);
    // the capture ran once per reported branch, BEFORE the terminal batch
    expect(ctxHelper.captured).toEqual(["changelog/x", "docs/y"]);
  });

  it("produces [branch] alone persists the branch row and never runs the diff capture", async () => {
    const seeded = await seedAgentNode(62);
    const ctxHelper = new DiffStubCtxHelper();
    const node = producingAgentNode(62, ctxHelper, ["changelog/x"]);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["branch"] });

    expect((await branchRowsOf(seeded.flowId)).map((r) => r.name)).toEqual(["changelog/x"]);
    expect(await diffArtifactsOf(seeded.flowId)).toEqual([]);
    expect(ctxHelper.captured).toEqual([]); // undeclared diff ⇒ no git I/O
  });

  it("produces [diff] alone persists the diff artifact without a branch row", async () => {
    const seeded = await seedAgentNode(63);
    const ctxHelper = new DiffStubCtxHelper();
    const node = producingAgentNode(63, ctxHelper, ["changelog/x"]);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["diff"] });

    expect(await branchRowsOf(seeded.flowId)).toEqual([]);
    const diffs = await diffArtifactsOf(seeded.flowId);
    expect(diffs.map((d) => d.branch)).toEqual(["changelog/x"]);
    expect(ctxHelper.captured).toEqual(["changelog/x"]);
  });

  it("an undeclared run persists neither (F4 — undeclared git facts stay dropped)", async () => {
    const seeded = await seedAgentNode(64);
    const ctxHelper = new DiffStubCtxHelper();
    const node = producingAgentNode(64, ctxHelper, ["changelog/x"]);

    await node.run(seeded.ctx, { prompt: "Do the work" }, {});

    expect(await branchRowsOf(seeded.flowId)).toEqual([]);
    expect(await diffArtifactsOf(seeded.flowId)).toEqual([]);
    expect(ctxHelper.captured).toEqual([]);
  });

  it("a failed diff capture still persists the diff fact with the unavailable marker (the stepRollup precedent)", async () => {
    const seeded = await seedAgentNode(65);
    const ctxHelper = new DiffStubCtxHelper();
    ctxHelper.failCapture = true;
    const node = producingAgentNode(65, ctxHelper, ["changelog/x"]);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    expect((await branchRowsOf(seeded.flowId)).map((r) => r.name)).toEqual(["changelog/x"]);
    const diffs = await diffArtifactsOf(seeded.flowId);
    expect(diffs).toHaveLength(1);
    const art = await testGet<{ content: string }>(
      `SELECT content FROM artifacts WHERE flow_id=$1 AND kind='diff'`,
      seeded.flowId,
    );
    expect(art?.content).toBe("(diff unavailable)");
  });

  it("a local run that reported no branches captures the diff from the worktree HEAD", async () => {
    const seeded = await seedAgentNode(66);
    const ctxHelper = new DiffStubCtxHelper();
    ctxHelper.localMode = true;
    const branchSpy = vi.spyOn(localGit, "currentBranch").mockResolvedValue("bugfix/local-66");
    const node = producingAgentNode(66, ctxHelper, []);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    expect(branchSpy).toHaveBeenCalledWith("/test/worktree");
    expect(ctxHelper.cwdReads).toEqual(["/test/worktree"]);
    expect((await branchRowsOf(seeded.flowId)).map((r) => r.name)).toEqual(["bugfix/local-66"]);
    expect((await diffArtifactsOf(seeded.flowId)).map((d) => d.branch)).toEqual(["bugfix/local-66"]);
    expect(ctxHelper.captured).toEqual(["bugfix/local-66"]);
  });

  it("a cloud run with no reported branches does no worktree git I/O", async () => {
    const seeded = await seedAgentNode(67);
    const ctxHelper = new DiffStubCtxHelper();
    const branchSpy = vi.spyOn(localGit, "currentBranch").mockResolvedValue("bugfix/local-67");
    const node = producingAgentNode(67, ctxHelper, []);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    expect(branchSpy).not.toHaveBeenCalled();
    expect(ctxHelper.captured).toEqual([]);
    expect(await diffArtifactsOf(seeded.flowId)).toEqual([]);
  });

  it("a local run without produces never probes the worktree (F4)", async () => {
    const seeded = await seedAgentNode(68);
    const ctxHelper = new DiffStubCtxHelper();
    ctxHelper.localMode = true;
    const branchSpy = vi.spyOn(localGit, "currentBranch").mockResolvedValue("bugfix/local-68");
    const node = producingAgentNode(68, ctxHelper, []);

    await node.run(seeded.ctx, { prompt: "Do the work" }, {});

    expect(branchSpy).not.toHaveBeenCalled();
    expect(ctxHelper.captured).toEqual([]);
    expect(await diffArtifactsOf(seeded.flowId)).toEqual([]);
  });
});

// ── Task 15: `secret_refs` → AgentStartSpec.env + the scoped prompt resolver ──

/** Seed the flow-secrets setting (the SecretStore's home) — values sealed
 *  through the IntegrationSecretStore exactly as Settings → secrets writes
 *  them, so the test exercises the real at-rest path. */
const seedSecrets = async (plain: Record<string, string>): Promise<void> => {
  const { SETTINGS_KEYS } = await import("@/constants/settings");
  await db.setSetting(SETTINGS_KEYS.SECRETS, db.integrationSecrets.sealSecretsMap(plain));
};

/** Every persisted place the run touches (the node's recorded input blob,
 *  artifacts, events) — the no-persistence sweep reads them raw. */
const persistedRunText = async (flowId: string): Promise<string> => {
  const nodes = await testAll<{ input: string | null; output: string | null }>(
    `SELECT input::text AS input, output::text AS output FROM nodes WHERE flow_id=$1`, flowId,
  );
  const artifacts = await testAll<{ content: string; meta: string | null }>(
    `SELECT content, meta FROM artifacts WHERE flow_id=$1`, flowId,
  );
  const events = await testAll<{ message: string; data: string | null }>(
    `SELECT message, data::text AS data FROM events WHERE flow_id=$1`, flowId,
  );
  return JSON.stringify({ nodes, artifacts, events });
};

describe("AgentTemplateNode — secret_refs (Task 15)", () => {
  it("a declared secret rides AgentStartSpec.env, and ONLY the declared ones do", async () => {
    await seedSecrets({ API_KEY: "sk-test-123", OTHER_KEY: "sk-other-456" });
    const seeded = await seedAgentNode(71);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(71, runner);

    await node.run(seeded.ctx, { prompt: "Do the work" }, { secret_refs: ["API_KEY"] });

    expect(runner.starts[0]?.env).toEqual({ API_KEY: "sk-test-123" });
  });

  it("a {{secrets.NAME}} prompt ref renders for the agent, while the recorded input keeps the {{...}} ref (never the value)", async () => {
    await seedSecrets({ API_KEY: "sk-test-123" });
    const seeded = await seedAgentNode(72);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(72, runner);

    await node.run(seeded.ctx, {}, { secret_refs: ["API_KEY"], prompt: "Deploy with {{secrets.API_KEY}}" });

    // the agent received the resolved value
    expect(runner.starts[0]?.prompt).toContain("Deploy with sk-test-123");
    // the recorded input keeps the template ref — no value anywhere
    const recorded = (await testGet<{ input: Record<string, unknown> | null }>(`SELECT input FROM nodes WHERE id=$1`, seeded.nodeId))?.input;
    if (recorded == null) throw new Error("the node run recorded no input");
    expect(recorded.prompt).toContain("Deploy with {{secrets.API_KEY}}");
    expect(String(JSON.stringify(recorded))).not.toContain("sk-test-123");
  });

  it("a {{secrets.X}} ref the node never declared fails the run loudly", async () => {
    await seedSecrets({ API_KEY: "sk-test-123" });
    const seeded = await seedAgentNode(73);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(73, runner);

    await expect(node.run(seeded.ctx, { prompt: "Use {{secrets.API_KEY}}" }, {})).rejects.toThrow(
      `${LABEL}: secret "API_KEY" is not declared in this node's secret_refs`,
    );
    expect(runner.starts).toHaveLength(0); // no agent ever started
  });

  it("a declared-but-unconfigured secret throws before any agent starts (no silent empty render)", async () => {
    await seedSecrets({ API_KEY: "sk-test-123" });
    const seeded = await seedAgentNode(74);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(74, runner);

    await expect(node.run(seeded.ctx, { prompt: "Do the work" }, { secret_refs: ["MISSING_KEY"] })).rejects.toThrow(
      `${LABEL}: secret "MISSING_KEY" is declared in the node's secret_refs but not configured`,
    );
    expect(runner.starts).toHaveLength(0);

    // the same loudness when the ref IS configured but the prompt renders it
    // through a resolver-less surface — undeclared there too
    await expect(
      node.run(seeded.ctx, { prompt: "Use {{secrets.MISSING_KEY}}" }, { secret_refs: ["MISSING_KEY"] }),
    ).rejects.toThrow("not configured");
  });

  it("no secret value is persisted anywhere — the recorded input, artifacts and events stay clean", async () => {
    await seedSecrets({ API_KEY: "sk-test-123" });
    const seeded = await seedAgentNode(75);
    const runner = new StubRunner({ status: "finished", result: FINISHED_TEXT });
    const node = agentNode(75, runner);

    await node.run(seeded.ctx, {}, { secret_refs: ["API_KEY"], prompt: "Deploy with {{secrets.API_KEY}}" });

    const persisted = await persistedRunText(seeded.flowId);
    expect(persisted).not.toContain("sk-test-123");
  });
});
