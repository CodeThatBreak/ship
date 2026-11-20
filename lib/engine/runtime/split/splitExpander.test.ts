/**
 * SplitExpander (step 07 split decomposition): the split runtime's stage
 * gate and expansion. Covered here: one child flow per unit with the
 * linkage-carrying payload, `node`/`template` target resolution and
 * auto-wrap, heterogeneous routing, re-expansion reconciliation, the
 * producer-error guards (contract mismatch, cycle, no units, `whole`) and
 * the engine's split gate end-to-end (the consumes handoff, Phase 4 mode
 * resolution, the several-sources fail-loudly rule).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const {
  db,
  flowEngine,
  engineParts,
  splitManager,
  setupSplitFixtures,
  seedParentFlow,
  setUnits,
  unit,
  childFlowsOf,
  consumerOf,
  until,
  joinSettled,
  engageConsumer,
  stubPort,
  FixtureWorkerDef,
  FixtureConsumerDef,
  declRow,
  declRowContract,
  must,
  templateStore,
} = await import("../../../../tests/helpers/splitFixtureHarness");
import type { SplitExpander } from "./splitExpander";

beforeAll(() => setupSplitFixtures());

/** the facade composes the expander (private member — test seam) */
const expander = (splitManager as unknown as { expander: SplitExpander }).expander;

describe("SplitExpander — expansion", () => {
  it("creates one child flow per unit; the payload carries the linkage (parentNodeKey + unit)", async () => {
    const flowId = await seedParentFlow(101);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await engageConsumer(flowId);

    expect(await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);

    const children = await childFlowsOf(flowId);
    expect(children.map((c) => c.unitKey)).toEqual(["a", "b"]);
    expect(children[0].payload).toMatchObject({
      parentNodeKey: "split_consumer_fixture",
      unit: { key: "a", title: "unit a", dependsOn: [], item: { key: "a" }, position: 0 },
    });
    expect(children[1].payload.unit.dependsOn).toEqual(["a"]);
    await until(joinSettled(flowId), "the node-target join"); // the consumer holds while units run
    expect((await consumerOf(flowId)).status).toBe("done");
  });

  it("a `template` target runs the declarative row; the unit rides {{input.unit.*}}", async () => {
    const flowId = await seedParentFlow(102);
    await setUnits(flowId, [unit("a"), unit("b")], declRow().id);

    await engageConsumer(flowId);

    expect(await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    await until(joinSettled(flowId), "the template-target join");

    expect((await consumerOf(flowId)).status).toBe("done");
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    // the child's agent prompt rendered the unit through {{input.unit.*}}
    expect(stubPort.prompts.some((p) => p.includes("Process the unit a — item a"))).toBe(true);
    expect(stubPort.prompts.some((p) => p.includes("Process the unit b — item b"))).toBe(true);
  });

  it("a unit.item outside the template target's start contract fails expansion loudly (no child rows)", async () => {
    const flowId = await seedParentFlow(103);
    await setUnits(flowId, [unit("a", { item: { key: "a" } })], declRowContract().id); // missing "service"

    await expect(expander.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .rejects.toThrow(/doesn't match the target template/);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a `node` target auto-wraps the node into a single-unit child template", async () => {
    const flowId = await seedParentFlow(104);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("n1")], "split_worker_fixture"); // registry key, not a row id

    await engageConsumer(flowId);

    expect(await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    await until(joinSettled(flowId), "the node-target join");

    expect((await consumerOf(flowId)).status).toBe("done");
    const child = must((await childFlowsOf(flowId))[0], "node-target child");
    const childTpl = await db.get<{ name: string; hidden: boolean }>(
      `SELECT f.name, f.hidden FROM flow_templates f JOIN flows c ON c.template_id=f.id WHERE c.id=$1`, child.id
    );
    expect(childTpl?.name).toBe("Split worker fixture · unit"); // the auto-wrapped graph
    expect(childTpl?.hidden).toBe(true);
    expect(FixtureWorkerDef.started).toEqual(["n1"]);
  });

  it("unit.target overrides the split config default (heterogeneous routing)", async () => {
    const flowId = await seedParentFlow(105);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [
      unit("t", { target: declRow().id }), // delivery template
      unit("n"), // default target = the node target set below
    ], "split_worker_fixture");

    await engageConsumer(flowId);

    await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the mixed-target join");

    expect((await consumerOf(flowId)).status).toBe("done");
    const children = await childFlowsOf(flowId);
    const tplOf = async (childId: string) =>
      (await db.get<{ name: string }>(
        `SELECT f.name FROM flow_templates f JOIN flows c ON c.template_id=f.id WHERE c.id=$1`, childId
      ))?.name;
    expect(await tplOf(must(children.find((c) => c.unitKey === "t"), "child t").id)).toBe("Unit worker declarative · unit");
    expect(await tplOf(must(children.find((c) => c.unitKey === "n"), "child n").id)).toBe("Split worker fixture · unit");
    expect(stubPort.prompts.some((p) => p.includes("Process the unit t"))).toBe(true);
    expect(FixtureWorkerDef.started).toEqual(["n"]);
  });

  it("re-expansion reconciles: new units get children, unchanged units keep theirs", async () => {
    const flowId = await seedParentFlow(106);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");
    await engageConsumer(flowId);
    await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the first join");
    const first = await childFlowsOf(flowId);

    // a plan refinement adds a unit — a and b must keep their child flows.
    // The real engine re-enters the consumer first (loop re-entry reset →
    // fresh stage claim); mirror it: the done aggregate is final until the
    // node is re-claimed (CR-009)
    await setUnits(flowId, [unit("a"), unit("b"), unit("c")], "split_worker_fixture");
    await engineParts.transitions.apply(flowId, "split_consumer_fixture", "loopReentry"); // done → pending
    await engageConsumer(flowId); // the fresh stage claim
    await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await childFlowsOf(flowId)).length === 3, "the third child");
    await until(async () => (await consumerOf(flowId)).units.length === 3, "the re-join");

    const second = await childFlowsOf(flowId);
    const idOf = (cs: typeof second, key: string) => must(cs.find((c) => c.unitKey === key), `child ${key}`).id;
    expect(idOf(second, "a")).toBe(idOf(first, "a")); // never recreated
    expect(idOf(second, "b")).toBe(idOf(first, "b"));
    expect(FixtureWorkerDef.started.filter((k) => k === "a")).toHaveLength(1); // not re-run either
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done", "c:done"]);
  });
});

describe("SplitExpander — guards", () => {
  it("nesting guard: a per-unit consumer inside a child flow resolves whole", async () => {
    // a child flow (parent_flow_id set) carrying a per-unit consumer + source
    const parentId = await seedParentFlow(501);
    const taskId = `task_nested_501`;
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "jira", `SPL-501-NESTED`, "nested", "open", "task", "P2"
    );
    const childFlowId = `flw_nested_501`;
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, template_id, parent_flow_id, kind, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'split',$7,$8)`,
      childFlowId, taskId, "nested child", "active", "tpl_sdlc_loop", parentId, new Date().toISOString(), new Date().toISOString()
    );
    for (const [key, type, config] of [
      ["split_source_fixture", "split_source_fixture", JSON.stringify({ units: [unit("n")] })],
      ["split_consumer_fixture", "split_consumer_fixture", JSON.stringify({ split_consume: "per-unit" })],
    ] as const) {
      await db.run(
        `INSERT INTO nodes (id, flow_id, node_key, type, status, config, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'pending',$5::jsonb,$6,$7)`,
        `node_nested_${key}`, childFlowId, key, type, config, new Date().toISOString(), new Date().toISOString()
      );
    }

    expect(await expander.expand(childFlowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
    expect(await db.all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=$1`, childFlowId)).toHaveLength(0);
  });

  it("a cycle in the unit DAG fails the expansion loudly before any child row exists", async () => {
    const flowId = await seedParentFlow(502);
    await setUnits(flowId, [unit("a", { dependsOn: ["b"] }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await expect(expander.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .rejects.toThrow(/unit dependency cycle: a → b → a/);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a source publishing no units never engages the manager", async () => {
    const flowId = await seedParentFlow(503);
    await setUnits(flowId, [], "split_worker_fixture"); // empty array

    expect(await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
    expect((await consumerOf(flowId)).status).toBe("pending"); // untouched
  });

  it("split_consume whole (or absent) never engages the manager", async () => {
    // `{split_consume: undefined}` drops the key in the stored JSON — the
    // absent case; `{split_consume: "whole"}` the explicit one
    for (const [index, config] of [
      [504, { split_consume: undefined }],
      [505, { split_consume: "whole" }],
    ] as const) {
      const flowId = await seedParentFlow(index, { consumerConfig: config });
      await setUnits(flowId, [unit("a")], "split_worker_fixture");

      expect(await expander.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
      expect(await childFlowsOf(flowId)).toHaveLength(0);
      expect((await consumerOf(flowId)).status).toBe("pending");
    }
  });
});

// ── Phase 4: the engine split gate (stageGate — the consumes handoff) ────────

describe("SplitExpander — the engine split gate", () => {
  it("per-unit via the gate: the source run activates the consumer, children expand, the join publishes, the whole path never runs", async () => {
    const flowId = await seedParentFlow(701);
    FixtureWorkerDef.reset();
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    await flowEngine.start(flowId);
    await until(async () => (await childFlowsOf(flowId)).length === 2, "the gate expansion");
    await until(joinSettled(flowId), "the gate join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    expect(FixtureConsumerDef.wholeRuns).toBe(0); // the split runtime owned the node
  });

  it("explicit whole is byte-identical: the def runs once, no children, no aggregate", async () => {
    const flowId = await seedParentFlow(702, { consumerConfig: { split_consume: "whole" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture");

    await flowEngine.start(flowId);
    await until(async () => (await consumerOf(flowId)).status === "done", "the whole run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
    const row = await db.get<{ output: unknown }>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId
    );
    expect(typeof row?.output === "string" ? JSON.parse(row.output) : row?.output ?? {}).toEqual({ whole: true });
  });

  it("source mode honors splitResolution: a per-unit recommendation expands", async () => {
    const flowId = await seedParentFlow(703, { consumerConfig: { split_consume: "source" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");
    await flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "per-unit" });

    await flowEngine.start(flowId);
    await until(joinSettled(flowId), "the recommended join");

    expect((await consumerOf(flowId)).status).toBe("done");
    expect(await childFlowsOf(flowId)).toHaveLength(2);
    expect(FixtureConsumerDef.wholeRuns).toBe(0);
  });

  it("source mode with no recommendation (or a whole one) consumes whole", async () => {
    for (const [index, resolution] of [[704, undefined], [705, "whole"]] as const) {
      const flowId = await seedParentFlow(index, { consumerConfig: { split_consume: "source" } });
      FixtureConsumerDef.reset();
      await setUnits(flowId, [unit("a")], "split_worker_fixture");
      if (resolution) await flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution });

      await flowEngine.start(flowId);
      await until(async () => (await consumerOf(flowId)).status === "done", `the ${resolution ?? "unrecommended"} whole run`);
      expect(FixtureConsumerDef.wholeRuns).toBe(1);
      expect(await childFlowsOf(flowId)).toHaveLength(0);
    }
  });

  it("explicit consumer choice wins over the recommendation, both ways", async () => {
    // per-unit consumer over a whole recommendation → expands
    let flowId = await seedParentFlow(706, { consumerConfig: { split_consume: "per-unit" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture");
    await flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "whole" });
    await flowEngine.start(flowId);
    await until(joinSettled(flowId), "the overridden join");
    expect(await childFlowsOf(flowId)).toHaveLength(1);
    expect(FixtureConsumerDef.wholeRuns).toBe(0);

    // whole consumer over a per-unit recommendation → today's path
    flowId = await seedParentFlow(707, { consumerConfig: { split_consume: "whole" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture");
    await flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "per-unit" });
    await flowEngine.start(flowId);
    await until(async () => (await consumerOf(flowId)).status === "done", "the whole-over-recommendation run");
    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("per-unit with no published units falls through to the whole path", async () => {
    const flowId = await seedParentFlow(708);
    FixtureConsumerDef.reset();
    await setUnits(flowId, [], "split_worker_fixture");

    await flowEngine.start(flowId);
    await until(async () => (await consumerOf(flowId)).status === "done", "the fall-through run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("conflict: a node whose fan-out knob engaged keeps the fan-out behavior", async () => {
    // fanout_mode "from-plan" resolves whole → the fan-out gate claims the
    // node (whole-wrap); the split knob is ignored and the whole path runs
    const flowId = await seedParentFlow(709, { consumerConfig: { fanout_mode: "from-plan", split_consume: "per-unit" } });
    FixtureConsumerDef.reset();
    await setUnits(flowId, [unit("a")], "split_worker_fixture");

    await flowEngine.start(flowId);
    // poll for the WRAPPED output, not the terminal status — the whole-wrap
    // write lands a beat after the outcome publish (a status poll can read
    // the pre-wrap output)
    await until(async () => {
      const row = await db.get<{ output: unknown }>(
        `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId);
      const out = typeof row?.output === "string" ? JSON.parse(row.output) : row?.output;
      return (out as { steps?: unknown[] } | null)?.steps != null;
    }, "the wrapped whole run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
    const row = await db.get<{ output: unknown }>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId
    );
    const out = (typeof row?.output === "string" ? JSON.parse(row.output) : row?.output ?? {}) as { steps?: { id: string }[] };
    expect(out.steps?.[0]?.id).toBe("whole"); // the fan-out whole-wrap ran, not the split join
  });

  it("several upstream sources fail the consumer loudly (never a silent pick)", async () => {
    const tplId = await templateStore.create({
      name: "split two-source parent 710",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "split_source_fixture", nodeTemplateId: "nt_split_source_fixture_1", trigger: { type: "auto" } },
        { key: "split_source_fixture_b", nodeTemplateId: "nt_split_source_fixture_b_1", trigger: { type: "auto" } },
        {
          key: "split_consumer_fixture",
          nodeTemplateId: "nt_split_consumer_fixture_1",
          trigger: { type: "auto" },
          config: { split_consume: "per-unit" },
        },
      ],
      edges: [
        { from: "split_source_fixture", to: "split_consumer_fixture", kind: "next" },
        { from: "split_source_fixture_b", to: "split_consumer_fixture", kind: "next" },
      ],
    }, { skipLint: true });
    const taskId = "task_split_710";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "jira", "SPL-710", "two sources", "open", "task", "P2"
    );
    const flowId = await flowEngine.create(taskId, "https://git.example.com/o/r", "two sources", { templateId: tplId });
    await flowEngine.start(flowId);

    await until(async () => (await consumerOf(flowId)).status === "failed", "the multi-source failure");
    const errors = await db.all<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND type='error'`, flowId
    );
    expect(errors.some((e) => e.message?.includes("several upstream nodes publish"))).toBe(true);
  });
});
