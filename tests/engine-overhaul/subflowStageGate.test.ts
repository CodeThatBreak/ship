/**
 * Task 26 — the declarative `subflow` kind on the StageGateRegistry (finding
 * B4): a subflow node expands exactly ONE child flow through the existing
 * `createStepChild` path with a start-contract-validated payload from the
 * node's `inputMap`; the child's terminal output publishes as the parent's
 * aggregate (or the declared `pass` mapping); a child whose start contract
 * fails fails the parent loudly without creating the child.
 *
 * Mirrors the stageGateDispatch test conventions: the real engine against
 * the isolated dockerized Postgres test database (AGENTS.md §1 — never a
 * demo/real DB), through the split fixture harness (stub agent port +
 * fixture defs — no runtime contacted).
 */
import { testGet, testAll, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  setupSplitFixtures,
  flowEngine,
  templateStore,
  until,
  db,
} from "../helpers/splitFixtureHarness";
import { NODE_KEYS } from "@/lib/engine/constants/nodeKeys";

beforeAll(async () => {
  await setupSplitFixtures();
  // the harness sets the stub harness at module load, BEFORE resetTestDatabase
  // truncates settings — re-assert it so the declarative child runs are hermetic
  await db.setSetting("default_harness", "stub");
});

/** The parent's step-kind child flows (the expansion's rows). */
const childFlowsOf = async (flowId: string): Promise<string[]> => {
  const rows = await testAll<{ id: string }>(
    `SELECT id FROM flows WHERE parent_flow_id=$1 AND kind='step' ORDER BY created_at, id`,
    flowId
  );
  return rows.map((r) => r.id);
};

/** A node's status + parsed output by instance key. */
const nodeOf = async (flowId: string, nodeKey: string): Promise<{ status: string; output: Record<string, unknown> }> => {
  const row = await testGet<{ status: string; output: unknown }>(
    `SELECT status, output FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey
  );
  if (!row) throw new Error(`node ${nodeKey} missing on flow ${flowId}`);
  const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row?.output;
  return { status: row.status, output: (parsed ?? {}) as Record<string, unknown> };
};

const seedTask = async (id: string, key: string): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    id, "jira", key, "subflow gate test", "open", "task", "P2"
  );
};

/** Events a flow recorded (the loud-failure assertions read the trail). */
const eventMessagesOf = async (flowId: string): Promise<string[]> => {
  const rows = await testAll<{ message: string }>(`SELECT message FROM events WHERE flow_id=$1`, flowId);
  return rows.map((r) => r.message);
};

/** The parent template: fixture source → subflow node (config + inputMap per test). */
const seedParentTemplate = async (index: number, childTplId: string, opts: { config?: Record<string, unknown>; inputMap?: Record<string, string> } = {}): Promise<string> => {
  return templateStore.create({
    name: `subflow parent ${index}`,
    trigger: { type: "manual", task_type: "jira" },
    nodes: [
      { key: "split_source_fixture", nodeTemplateId: "nt_split_source_fixture_1", trigger: { type: "auto" } },
      {
        key: NODE_KEYS.SUBFLOW,
        nodeTemplateId: "nt_subflow",
        trigger: { type: "auto" },
        config: { child: childTplId, parallel_max: 1, ...opts.config },
        inputMap: opts.inputMap,
      },
    ],
    edges: [{ from: "split_source_fixture", to: NODE_KEYS.SUBFLOW, kind: "next" }],
  }, { skipLint: true });
};

describe("subflow stage gate (task 26 — the delegated child)", () => {
  it("the live engine's registry pins the built-in gates in the frozen order — fan-out, split, then subflow", () => {
    expect(flowEngine.stageGates.entries()).toEqual([{ name: "fanout" }, { name: "split" }, { name: "subflow" }]);
  });

  it("a subflow node expands exactly one child flow with a start-contract-validated payload, and the child's terminal output lands as the parent's aggregate", async () => {
    // the child worker: a declarative agent row run through the stub port —
    // its prompt records the delegated input, its markdown output is the
    // terminal output the rollup publishes
    const childRow = await templateStore.createNodeTemplate({
      key: "subflow_child_worker",
      name: "Subflow child worker",
      kind: "agent",
      config: { mode: "plan", output: "markdown", prompt: "delegate {{input.service}}" },
    });
    // the child template declares a start contract the inputMap must satisfy
    const childTpl = await templateStore.create({
      name: "subflow child contract 901",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        {
          key: NODE_KEYS.START,
          nodeTemplateId: "nt_start",
          trigger: { type: "auto" },
          config: { contract: [{ key: "service", label: "Service", type: "string", required: true }] },
        },
        { key: "child_worker", nodeTemplateId: childRow.id, trigger: { type: "auto" } },
      ],
      edges: [{ from: NODE_KEYS.START, to: "child_worker", kind: "next" }],
    }, { skipLint: true });
    const tplId = await seedParentTemplate(901, childTpl, { inputMap: { service: "'svc-a'" } });
    await seedTask("task_sub_901", "SUB-901");
    const flowId = await flowEngine.create("task_sub_901", "https://git.example.com/o/r", "subflow delegates", { templateId: tplId });

    await flowEngine.start(flowId);
    await until(async () => (await childFlowsOf(flowId)).length === 1, "the one delegated child");
    await until(async () => (await nodeOf(flowId, NODE_KEYS.SUBFLOW)).status === "done", "the aggregate publish");

    // exactly ONE child — the gate owns the stage (the def never ran: a
    // SubflowNode run fails loudly, and the node is done)
    expect(await childFlowsOf(flowId)).toHaveLength(1);
    // the validated payload reached the child: the start contract's field
    // rode the inputMap evaluation into the child worker's recorded prompt
    const childId = (await childFlowsOf(flowId))[0];
    const worker = await testGet<{ input: unknown }>(
      `SELECT input FROM nodes WHERE flow_id=$1 AND node_key='child_worker'`, childId
    );
    // the raw jsonb may arrive as a string or a parsed object — stringify covers both
    expect(JSON.stringify(worker?.input ?? "")).toContain("svc-a");
    // the child's terminal output (merged node outputs) is the parent's
    // aggregate — the start contract's published values + the worker's output
    const parent = await nodeOf(flowId, NODE_KEYS.SUBFLOW);
    expect(parent.output.markdown).toBe("stub unit output");
    expect(parent.output.service).toBe("svc-a");
  });

  it("the declared pass mapping reshapes the child's terminal output as the parent's aggregate", async () => {
    const childRow = await templateStore.createNodeTemplate({
      key: "subflow_child_worker_pass",
      name: "Subflow child worker pass",
      kind: "agent",
      config: { mode: "plan", output: "markdown", prompt: "delegate {{input.service}}" },
    });
    const childTpl = await templateStore.create({
      name: "subflow child pass 902",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "child_worker", nodeTemplateId: childRow.id, trigger: { type: "auto" } },
      ],
      edges: [],
    }, { skipLint: true });
    const tplId = await seedParentTemplate(902, childTpl, {
      inputMap: { service: "'svc-b'" },
      config: { pass: { echo: "markdown" } },
    });
    await seedTask("task_sub_902", "SUB-902");
    const flowId = await flowEngine.create("task_sub_902", "https://git.example.com/o/r", "subflow passes", { templateId: tplId });

    await flowEngine.start(flowId);
    await until(async () => (await childFlowsOf(flowId)).length === 1, "the one delegated child");
    await until(async () => (await nodeOf(flowId, NODE_KEYS.SUBFLOW)).status === "done", "the aggregate publish");

    // the pass mapping won: the mapped field published, the raw child output did not
    const parent = await nodeOf(flowId, NODE_KEYS.SUBFLOW);
    expect(parent.output).toEqual({ echo: "stub unit output" });
  });

  it("a subflow whose child start contract fails fails loudly without creating the child", async () => {
    const childRow = await templateStore.createNodeTemplate({
      key: "subflow_child_worker_fail",
      name: "Subflow child worker fail",
      kind: "agent",
      config: { mode: "plan", output: "markdown", prompt: "delegate {{input.service}}" },
    });
    const childTpl = await templateStore.create({
      name: "subflow child contract 903",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        {
          key: NODE_KEYS.START,
          nodeTemplateId: "nt_start",
          trigger: { type: "auto" },
          config: { contract: [{ key: "service", label: "Service", type: "string", required: true }] },
        },
        { key: "child_worker", nodeTemplateId: childRow.id, trigger: { type: "auto" } },
      ],
      edges: [{ from: NODE_KEYS.START, to: "child_worker", kind: "next" }],
    }, { skipLint: true });
    // the inputMap maps NOTHING — the required contract field is missing
    const tplId = await seedParentTemplate(903, childTpl, {});
    await seedTask("task_sub_903", "SUB-903");
    const flowId = await flowEngine.create("task_sub_903", "https://git.example.com/o/r", "subflow contract fail", { templateId: tplId });

    await flowEngine.start(flowId);
    await until(async () => (await nodeOf(flowId, NODE_KEYS.SUBFLOW)).status === "failed", "the loud contract failure");

    // no child row exists — the contract validated before any row
    expect(await childFlowsOf(flowId)).toHaveLength(0);
    // the failure is loud in the trail: the stage's error event names the contract
    const messages = await eventMessagesOf(flowId);
    expect(messages.some((m) => m.includes("start contract"))).toBe(true);
  });
});
