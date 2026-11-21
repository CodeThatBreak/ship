/**
 * Task 24 — the stage-ownership gates dispatch through the StageGateRegistry
 * (finding E1): the StageRunner consults the registered gates instead of the
 * literal `stepFlows.gate()` → `splitManager.stageGate()` chain. The three
 * dispatch shapes through the real engine, byte-for-byte against the old
 * chain: the fan-out expansion owns the node ("own"), the fan-out whole-wrap
 * runs the def then post-processes ({ run, afterRun } — and it shadows the
 * split gate, the old chain's short-circuit), the split gate owns its
 * consumer, and a flow matching NO gate walks the frozen default whole path
 * and its default edge.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB), through the split fixture harness
 * (stub agent port + fixture defs — no runtime contacted).
 */
import { testGet, testAll, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  setupSplitFixtures,
  seedParentFlow,
  setUnits,
  unit,
  childFlowsOf,
  consumerOf,
  until,
  joinSettled,
  flowEngine,
  templateStore,
  FixtureConsumerDef,
  FixtureWorkerDef,
} from "../helpers/splitFixtureHarness";

beforeAll(() => setupSplitFixtures());

const now = () => new Date().toISOString();

/** The parent node's parsed output (the aggregate / whole shape under test). */
const outputOf = async (flowId: string): Promise<Record<string, unknown>> => {
  const row = await testGet<{ output: unknown }>(
    `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId
  );
  const parsed = typeof row?.output === "string" ? JSON.parse(row.output) : row?.output;
  return (parsed ?? {}) as Record<string, unknown>;
};

/** The parent's fan-out step children (kind='step' — the expansion's rows). */
const stepChildrenOf = async (flowId: string): Promise<string[]> => {
  const rows = await testAll<{ id: string }>(
    `SELECT id FROM flows WHERE parent_flow_id=$1 AND kind='step' ORDER BY created_at, id`, flowId
  );
  return rows.map((r) => r.id);
};

const seedTask = async (id: string, key: string, summary: string): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    id, "jira", key, summary, "open", "task", "P2"
  );
};

describe("stage gate dispatch (task 24 — the registered axis)", () => {
  it("the live engine's registry pins the built-in gates in the frozen order — fan-out first, then split, then subflow (task 26)", () => {
    expect(flowEngine.stageGates.entries()).toEqual([{ name: "fanout" }, { name: "split" }, { name: "subflow" }]);
  });

  it("the fan-out expansion owns the node: one child flow per pending plan step, the def never runs, the aggregate publishes", async () => {
    // the child template the fanout_child knob picks — a one-node fixture
    // worker (no git, no agent), so the whole expansion is hermetic
    const childTpl = await templateStore.create({
      name: "stage-gate dispatch child 801",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "split_worker_fixture", nodeTemplateId: "nt_split_worker_fixture_1", trigger: { type: "auto" } },
      ],
      edges: [],
    }, { skipLint: true });
    FixtureWorkerDef.reset();
    FixtureConsumerDef.reset();

    const tplId = await templateStore.create({
      name: "stage-gate dispatch fanout 801",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "split_source_fixture", nodeTemplateId: "nt_split_source_fixture_1", trigger: { type: "auto" } },
        {
          key: "split_consumer_fixture",
          nodeTemplateId: "nt_split_consumer_fixture_1",
          trigger: { type: "auto" },
          // the split knob is present but shadowed — the fan-out gate is
          // consulted FIRST (the frozen registration order) and claims;
          // parallel_max 2 + disjoint step files start both children in the
          // expand-time scheduling pass
          config: {
            split_consume: "whole",
            fanout_mode: "steps",
            fanout_child: childTpl,
            fanout_parallel_max: 2,
          },
        },
      ],
      edges: [{ from: "split_source_fixture", to: "split_consumer_fixture", kind: "next" }],
    }, { skipLint: true });
    await seedTask("task_gate_801", "GATE-801", "fanout owns");
    const flowId = await flowEngine.create("task_gate_801", "https://git.example.com/o/r", "fanout owns", { templateId: tplId });
    // the pending checklist the expansion fans out over
    const stepRows = [
      { id: "ps_801a", title: "Step a", position: 0, files: ["a.ts"] },
      { id: "ps_801b", title: "Step b", position: 1, files: ["b.ts"] },
    ];
    for (const step of stepRows) {
      await testRun(
        `INSERT INTO plan_steps (id, flow_id, title, status, position, files, created_at, updated_at) VALUES ($1,$2,$3,'pending',$4,$5::jsonb,$6,$7)`,
        step.id, flowId, step.title, step.position, JSON.stringify(step.files), now(), now(),
      );
    }

    await flowEngine.start(flowId);
    await until(async () => (await stepChildrenOf(flowId)).length === 2, "the fan-out expansion");
    await until(async () => (await consumerOf(flowId)).status === "done", "the aggregate publish");

    // the fan-out gate claimed the stage ("own"): the consumer's def never ran
    expect(FixtureConsumerDef.wholeRuns).toBe(0);
    // the children resolved and the roll-up published the aggregate
    const out = await outputOf(flowId);
    const steps = out.steps as Array<{ title: string; status: string }> | undefined;
    expect(steps?.map((s) => `${s.title}:${s.status}`)).toEqual(["Step a:done", "Step b:done"]);
    // no split children — the shadowed split gate never engaged
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("the fan-out whole-wrap gate claims post-run: the def runs once and the output wraps, the split knob ignored", async () => {
    // fanout_mode "from-plan" resolves whole (no plan published) → the
    // fan-out gate answers { run, afterRun }; the engaged split knob is
    // shadowed (the old chain's `fanout == null &&` short-circuit)
    const flowId = await seedParentFlow(802, { consumerConfig: { fanout_mode: "from-plan", split_consume: "per-unit" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture");

    await flowEngine.start(flowId);
    await until(async () => (await outputOf(flowId)).steps != null, "the wrapped whole run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1); // the def's normal whole path ran
    expect(await childFlowsOf(flowId)).toHaveLength(0); // no split expansion
    expect(await stepChildrenOf(flowId)).toHaveLength(0); // no fan-out expansion
    const out = await outputOf(flowId);
    expect((out.steps as Array<{ id: string }>)[0]?.id).toBe("whole"); // the afterRun wrapped it
  });

  it("the split gate owns its consumer: the units expand, the join publishes, the whole path never runs", async () => {
    const flowId = await seedParentFlow(803);
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    await flowEngine.start(flowId);
    await until(async () => (await childFlowsOf(flowId)).length === 2, "the split expansion");
    await until(joinSettled(flowId), "the split join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    expect(FixtureConsumerDef.wholeRuns).toBe(0); // the split runtime owned the node
    expect(await stepChildrenOf(flowId)).toHaveLength(0); // no fan-out expansion
  });

  it("no gate claims: the frozen default whole path runs and the default edge walk advances", async () => {
    const tplId = await templateStore.create({
      name: "stage-gate dispatch default 804",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "split_source_fixture", nodeTemplateId: "nt_split_source_fixture_1", trigger: { type: "auto" } },
        {
          key: "split_consumer_fixture",
          nodeTemplateId: "nt_split_consumer_fixture_1",
          trigger: { type: "auto" },
          config: { split_consume: "whole" }, // the split gate answers "run"
        },
        { key: "split_worker_fixture", nodeTemplateId: "nt_split_worker_fixture_1", trigger: { type: "auto" } },
      ],
      edges: [
        { from: "split_source_fixture", to: "split_consumer_fixture", kind: "next" },
        { from: "split_consumer_fixture", to: "split_worker_fixture", kind: "next" },
      ],
    }, { skipLint: true });
    await seedTask("task_gate_804", "GATE-804", "default edge");
    const flowId = await flowEngine.create("task_gate_804", "https://git.example.com/o/r", "default edge", { templateId: tplId });
    FixtureConsumerDef.reset();
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture"); // units exist but the knob consumes whole

    await flowEngine.start(flowId);
    await until(async () => (await consumerOf(flowId)).status === "done", "the whole run");
    await until(async () => {
      const row = await testGet<{ status: string }>(
        `SELECT status FROM nodes WHERE flow_id=$1 AND node_key='split_worker_fixture'`, flowId
      );
      return row?.status === "done";
    }, "the default edge walk");

    expect(FixtureConsumerDef.wholeRuns).toBe(1); // the def's normal whole path
    const out = await outputOf(flowId);
    expect(out).toEqual({ whole: true }); // no wrap, no aggregate — the raw def output
    expect(await childFlowsOf(flowId)).toHaveLength(0);
    expect(await stepChildrenOf(flowId)).toHaveLength(0);
  });
});
