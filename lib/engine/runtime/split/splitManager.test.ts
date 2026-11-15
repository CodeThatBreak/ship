/**
 * Agent-node split plan, Phase 2 — the split runtime (§7 item 2), demonstrated
 * by a fixture source + fixture consumer + fixture targets against the real
 * engine and real child-flow rows:
 *
 *   - expansion reconciles on re-run (new units get children, unchanged units
 *     keep theirs), and the child payload carries the linkage
 *   - scheduling = dependsOn + slot (parallel_max 1 vs N — no file-overlap
 *     inference)
 *   - a failed unit blocks its dependents; non-dependents proceed
 *   - the join publishes the aggregate in unit order, failed entry present
 *   - skip / retry / approve / cancel per unit, addressed by unit.key
 *   - the nesting guard (a per-unit consumer inside a child flow → whole)
 *   - cycle detection at expansion fails loudly before any child row exists
 *   - `whole` (or absent) never engages the manager
 *
 * Targets: a `node` target (the fixture worker, a builtin-style def) and a
 * `template` target (a declarative agent row, run through a stub agent port
 * so no runtime is contacted) — the two kinds the Phase-1 lookup resolves.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

const { db } = await import("../../../db/app");
const { flowEngine } = await import("../../flowEngine");
const { splitManager } = await import("./splitManager");
const { NodeDefinition } = await import("../../nodes/shared/nodeDefinition");
const { nodeRegistry } = await import("../../nodes/registry");
const { templateStore } = await import("../../templates/templateStore");
const { agentPortRegistry } = await import("../../ports/agentPort");
const { AgentDefSchema } = await import("../../nodes/declarativeSchemas");
const { NODE_KEYS } = await import("../../constants/nodeKeys");
const { splitConsumeOf, splitParallelMaxOf } = await import("../../nodes/shared/split");
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "../../ports/agentPort";
import type { FlowCtx } from "../../nodes/shared/nodeSharedExports";
import type { RunOutcome } from "../../nodes/shared/nodeDefinition";
import type { SplitChildPayload } from "./splitManager";
import type { SplitUnit } from "../../nodes/shared/split";

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

// ── stub agent port (hermetic runs for the declarative template target) ──────

/** Finishes every run successfully; records the start prompts so tests can
 *  assert the unit rode `{{input.unit.*}}` into the child's prompt. */
class StubAgentPort implements AgentPort {
  readonly kind = "stub-cloud";
  readonly label = "Stub cloud";
  readonly execMode = "cloud" as const;
  readonly harness = "stub";
  readonly fallbackModels = [];
  readonly listDiscount = 0;
  /** start prompts in call order */
  readonly prompts: string[] = [];
  private counter = 0;

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    this.prompts.push(spec.prompt);
    this.counter += 1;
    return { agentId: `agt_stub_${this.counter}`, runId: `run_stub_${this.counter}` };
  }

  async stream(): Promise<AgentStreamOutcome> {
    return { result: { status: "finished", result: "stub unit output" } };
  }

  async getRun(): Promise<AgentRunQuery> {
    return { state: "running" };
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  hasActiveRun(): boolean {
    return false;
  }

  releaseActiveRun(): void {}

  async getUsage(): Promise<AgentRunUsage | null> {
    return null;
  }

  async inspectSession(): Promise<{ completed: boolean; text: string } | null> {
    return null;
  }

  async listCatalog(): Promise<null> {
    return null;
  }

  async status(): Promise<{ configured: boolean }> {
    return { configured: true };
  }
}

const stubPort = new StubAgentPort();
agentPortRegistry.register(stubPort);
await db.setSetting("default_harness", "stub"); // forMode("cloud") selects the stub

// ── fixture defs (registered like built-ins; catalog rows seeded below) ──────

type WorkerItem = { behavior?: "ok" | "fail" | "fail-once" | "hold"; summary?: string };

/**
 * The unit's worker — the node a `node`-target split child runs. Behavior
 * comes from the unit's item data (riding `{{input.unit.*}}` through the
 * trigger payload): `fail` always fails, `fail-once` fails its first run then
 * succeeds (the retry path), `hold` parks at `awaiting_approval` (the
 * approve path).
 */
class FixtureWorkerDef extends NodeDefinition<Record<string, unknown>, { summary: string }> {
  readonly key = "split_worker_fixture";
  readonly label = "Split worker fixture";
  readonly promptKeys = [];
  readonly order = 900;
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.object({ summary: z.string() });
  /** unit keys in start order — the scheduling-order journal */
  static started: string[] = [];
  /** per-unit run count — drives `fail-once` */
  static readonly runs = new Map<string, number>();
  static reset(): void {
    FixtureWorkerDef.started = [];
    FixtureWorkerDef.runs.clear();
  }

  async run(ctx: FlowCtx, _input: Record<string, unknown>): Promise<RunOutcome> {
    void _input;
    const payload = (ctx.flow.triggerPayload ?? {}) as { unit?: { key?: string; item?: WorkerItem } };
    const unitKey = payload.unit?.key ?? "?";
    FixtureWorkerDef.started.push(unitKey);
    const count = (FixtureWorkerDef.runs.get(unitKey) ?? 0) + 1;
    FixtureWorkerDef.runs.set(unitKey, count);
    const node = await this.support.nodeByKey(ctx.flow.id, this.key);
    await this.support.setNode(node.id, { status: "running" });
    await this.recordInput(node.id, { unitKey });
    const item = payload.unit?.item ?? {};
    if (item.behavior === "fail" || (item.behavior === "fail-once" && count === 1)) {
      throw new Error(`unit ${unitKey} failed (run ${count})`);
    }
    if (item.behavior === "hold") {
      return this.applyOutcome(ctx, {
        output: { summary: item.summary ?? `held:${unitKey}` },
        status: "awaiting_approval",
        event: `unit ${unitKey} holds for approval`,
        reply: "",
      });
    }
    return this.applyOutcome(ctx, {
      output: { summary: item.summary ?? `done:${unitKey}` },
      status: "done",
      event: `unit ${unitKey} done`,
      reply: "",
    });
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

/** The fixture source — publishes the units configured on its node row. */
class FixtureSourceDef extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string = "split_source_fixture";
  readonly label: string = "Split source fixture";
  readonly promptKeys = [];
  readonly order: number = 901;
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.record(z.string(), z.unknown());
  override readonly configSchema = z
    .object({
      units: z.array(z.unknown()).optional(),
      resolution: z.enum(["whole", "per-unit"]).optional(),
      split_target: z.string().optional(),
    })
    .passthrough();
  /** the units and the §2.4 resolution recommendation, both from the node row */
  protected async knobs(ctx: FlowCtx): Promise<{ units: unknown; resolution: unknown }> {
    const cfg = await this.nodeConfig(ctx);
    return { units: cfg.units, resolution: cfg.resolution };
  }

  override async splitUnits(ctx: FlowCtx): Promise<SplitUnit[] | null> {
    const units = (await this.knobs(ctx)).units;
    return Array.isArray(units) ? (units as SplitUnit[]) : null;
  }

  /**
   * The Phase-4 recommendation port, driven by the node's `resolution` knob:
   * "per-unit" | "whole" | unset (no recommendation).
   */
  override async splitResolution(ctx: FlowCtx): Promise<"whole" | "per-unit" | null> {
    const v = (await this.knobs(ctx)).resolution;
    return v === "per-unit" || v === "whole" ? v : null;
  }

  async run(ctx: FlowCtx): Promise<RunOutcome> {
    // a normal whole-mode run: the engine gate tests drive the real trigger
    // path (source finishes → advance → the consumer's split gate)
    return this.applyOutcome(ctx, {
      output: {},
      status: "done",
      event: "fixture source finished",
      reply: "",
    });
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

/** A second split source def — the multi-source conflict test needs two
 *  distinct upstream defs (node_templates keys are UNIQUE(key, version)). */
class FixtureSourceDefB extends FixtureSourceDef {
  override readonly key = "split_source_fixture_b";
  override readonly label = "Split source fixture B";
  override readonly order = 903;
}

/** The fixture consumer — per-unit, with a simple aggregate contract. */
const CONSUMER_AGGREGATE = z.object({
  units: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.string(),
      output: z.unknown().optional(),
    })
  ),
});

class FixtureConsumerDef extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key = "split_consumer_fixture";
  readonly label = "Split consumer fixture";
  readonly promptKeys = [];
  readonly order = 902;
  override readonly capabilities = { splitOutput: CONSUMER_AGGREGATE };
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.record(z.string(), z.unknown());
  override readonly configSchema = z
    .object({
      split_consume: z.enum(["whole", "per-unit", "source"]).optional(),
      split_parallel_max: z.number().optional(),
      fanout_mode: z.enum(["whole", "steps", "from-plan"]).optional(),
      fanout_parallel_max: z.number().optional(),
    })
    .passthrough();

  /** whole-path run count — the gate tests assert the def did (or didn't) run */
  static wholeRuns = 0;
  static reset(): void {
    FixtureConsumerDef.wholeRuns = 0;
  }

  async run(ctx: FlowCtx): Promise<RunOutcome> {
    // the whole-mode path — never taken while the split manager owns the node
    FixtureConsumerDef.wholeRuns += 1;
    return this.applyOutcome(ctx, {
      output: { whole: true },
      status: "done",
      event: "consumer ran whole",
      reply: "",
    });
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

for (const def of [new FixtureWorkerDef(), new FixtureSourceDef(), new FixtureSourceDefB(), new FixtureConsumerDef()]) {
  if (!nodeRegistry.has(def.key)) nodeRegistry.register(def);
}

/** Built-in-style catalog rows so templates can instance the fixture defs. */
async function seedCatalogRow(index: number, key: string, name: string): Promise<void> {
  await db.run(
    `INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
     VALUES ($1,$2,$3,'builtin',1,$4,NULL,'{}'::jsonb,true,$5,$6)
     ON CONFLICT DO NOTHING`,
    `nt_${key}_${index}`, key, name, `fixture catalog row ${name}`, now(), now()
  );
}
await seedCatalogRow(1, "split_worker_fixture", "Split worker fixture");
await seedCatalogRow(1, "split_source_fixture", "Split source fixture");
await seedCatalogRow(1, "split_consumer_fixture", "Split consumer fixture");
// a second SOURCE def for the multi-source conflict test (catalog keys are
// UNIQUE(key, version) — the second source needs its own def + row)
await seedCatalogRow(1, "split_source_fixture_b", "Split source fixture B");

/** The `template` targets — declarative agent rows (resolved by row id, the
 *  Phase-1 lookup). The contract row declares a start contract the unit item
 *  must match (the compatibility check). */
const DECL_ROW = must(
  await templateStore.createNodeTemplate({
    key: "unit_worker_decl",
    name: "Unit worker declarative",
    kind: "agent",
    config: { mode: "plan", output: "markdown", prompt: "Process the unit {{input.unit.key}} — {{input.unit.item.summary}}" },
  }),
  "declarative agent row"
);
const DECL_ROW_CONTRACT = must(
  await templateStore.createNodeTemplate({
    key: "unit_worker_contract",
    name: "Unit worker contract",
    kind: "agent",
    config: {
      mode: "plan",
      output: "markdown",
      prompt: "process",
      contract: [{ key: "service", label: "Service", type: "string", required: true }],
    },
  }),
  "declarative contract row"
);

// ── seeding + polling helpers ────────────────────────────────────────────────

/** One isolated parent flow on a fixture template: source → consumer. The
 *  consumer is per-unit unless overridden; the source's default target and
 *  units are set per test via `setUnits`. */
async function seedParentFlow(
  index: number,
  opts: { consumerConfig?: Record<string, unknown> } = {},
): Promise<string> {
  const tplId = await templateStore.create({
    name: `split fixture parent ${index}`,
    trigger: { type: "manual", task_type: "jira" },
    nodes: [
      { key: "split_source_fixture", nodeTemplateId: "nt_split_source_fixture_1", trigger: { type: "auto" } },
      {
        key: "split_consumer_fixture",
        nodeTemplateId: "nt_split_consumer_fixture_1",
        trigger: { type: "auto" },
        config: { split_consume: "per-unit", ...opts.consumerConfig },
      },
    ],
    edges: [{ from: "split_source_fixture", to: "split_consumer_fixture", kind: "next" }],
  }, { skipLint: true });
  const taskId = `task_split_${index}`;
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "jira", `SPL-${index}`, "split runtime test", "open", "task", "P2"
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `split fixture ${index}`, { templateId: tplId });
}

async function setUnits(flowId: string, units: SplitUnit[], target?: string): Promise<void> {
  await flowEngine.setNodeConfig(flowId, "split_source_fixture", {
    ...(target ? { split_target: target } : {}),
    units,
  });
}

const unit = (key: string, opts: { dependsOn?: string[]; target?: string; item?: unknown } = {}): SplitUnit => ({
  key,
  title: `unit ${key}`,
  dependsOn: opts.dependsOn ?? [],
  ...(opts.target ? { target: opts.target } : {}),
  item: opts.item ?? { key, summary: `item ${key}` },
});

/** The parent's split children (the derived linkage), in expansion order. */
async function childFlowsOf(flowId: string): Promise<{ id: string; unitKey: string; payload: SplitChildPayload }[]> {
  const rows = await db.all<{ id: string; triggerPayload: unknown }>(
    `SELECT id, trigger_payload AS "triggerPayload" FROM flows WHERE parent_flow_id=$1 AND kind='split' ORDER BY created_at, id`,
    flowId
  );
  return rows.map((r) => {
    const payload = must(
      r.triggerPayload == null
        ? undefined
        : (typeof r.triggerPayload === "string" ? JSON.parse(r.triggerPayload) : r.triggerPayload) as SplitChildPayload,
      `split payload of child ${r.id}`
    );
    return { id: r.id, unitKey: payload.unit.key, payload };
  });
}

interface AggregateEntry { key: string; title: string; status: string; output?: unknown }

/** The consumer node's status + parsed aggregate output. */
async function consumerOf(flowId: string): Promise<{ status: string; units: AggregateEntry[] }> {
  const row = must(
    await db.get<{ status: string; output: unknown }>(
      `SELECT status, output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId
    ),
    `consumer node of ${flowId}`
  );
  const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
  const output = (parsed ?? {}) as { units?: AggregateEntry[] };
  return { status: row.status, units: output.units ?? [] };
}

/** Poll the DB until the async engine bg work settles (or fail loudly). */
async function until(cond: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const joinSettled = (flowId: string) => async () => {
  const c = await consumerOf(flowId);
  return c.units.length > 0 && c.units.every((u) => ["done", "failed", "blocked", "skipped", "awaiting_approval"].includes(u.status));
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("SplitManager — expansion", () => {
  it("creates one child flow per unit; the payload carries the linkage (parentNodeKey + unit)", async () => {
    const flowId = await seedParentFlow(101);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);

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
    await setUnits(flowId, [unit("a"), unit("b")], DECL_ROW.id);

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    await until(joinSettled(flowId), "the template-target join");

    expect((await consumerOf(flowId)).status).toBe("done");
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    // the child's agent prompt rendered the unit through {{input.unit.*}}
    expect(stubPort.prompts.some((p) => p.includes("Process the unit a — item a"))).toBe(true);
    expect(stubPort.prompts.some((p) => p.includes("Process the unit b — item b"))).toBe(true);
  });

  it("a unit.item outside the template target's start contract fails expansion loudly (no child rows)", async () => {
    const flowId = await seedParentFlow(103);
    await setUnits(flowId, [unit("a", { item: { key: "a" } })], DECL_ROW_CONTRACT.id); // missing "service"

    await expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .rejects.toThrow(/doesn't match the target template/);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a `node` target auto-wraps the node into a single-unit child template", async () => {
    const flowId = await seedParentFlow(104);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("n1")], "split_worker_fixture"); // registry key, not a row id

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
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
      unit("t", { target: DECL_ROW.id }), // delivery template
      unit("n"), // default target = the node target set below
    ], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
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
    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the first join");
    const first = await childFlowsOf(flowId);

    // a plan refinement adds a unit — a and b must keep their child flows
    await setUnits(flowId, [unit("a"), unit("b"), unit("c")], "split_worker_fixture");
    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
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

describe("SplitManager — scheduling (deps + slot)", () => {
  it("parallel_max 1: a later independent unit yields to an earlier dependent", async () => {
    const flowId = await seedParentFlow(201);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the serial join");

    // b (no deps) waits twice: behind a's slot, then behind c (earlier position)
    expect(FixtureWorkerDef.started).toEqual(["a", "c", "b"]);
    expect((await consumerOf(flowId)).units.map((u) => u.status)).toEqual(["done", "done", "done"]);
  });

  it("parallel_max 2: independents start together (no file-overlap inference)", async () => {
    const flowId = await seedParentFlow(202, { consumerConfig: { split_parallel_max: 2 } });
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the parallel join");

    // the free slot lets b start beside a, before its dependent c
    expect(FixtureWorkerDef.started).toEqual(["a", "b", "c"]);
  });

  it("a unit depending on an unknown key never starts — it surfaces blocked, the join still publishes", async () => {
    const flowId = await seedParentFlow(203);
    await setUnits(flowId, [unit("a", { dependsOn: ["ghost"] })], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the ghost-dep join");

    expect((await consumerOf(flowId)).units).toEqual([
      expect.objectContaining({ key: "a", status: "blocked" }),
    ]);
  });
});

describe("SplitManager — failure semantics + join", () => {
  it("a failed unit blocks its dependents; non-dependents proceed; the join surfaces it all", async () => {
    const flowId = await seedParentFlow(301);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [
      unit("a", { item: { behavior: "fail" } }),
      unit("c", { dependsOn: ["a"] }),
      unit("b"),
    ], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the failed join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("failed"); // worst-of (decision 4)
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "c:blocked", "b:done"]);
    // the blocked dependent was never started
    const cChild = must((await childFlowsOf(flowId)).find((c) => c.unitKey === "c"), "child c");
    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1`, cChild.id))?.status).toBe("pending");
    expect(FixtureWorkerDef.started).toEqual(["a", "b"]);
  });

  it("the aggregate publishes in unit order (positions), not completion order", async () => {
    const flowId = await seedParentFlow(302, { consumerConfig: { split_parallel_max: 3 } });
    await setUnits(flowId, [unit("z"), unit("m"), unit("a")], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the ordered join");

    expect((await consumerOf(flowId)).units.map((u) => u.key)).toEqual(["z", "m", "a"]);
  });
});

describe("SplitManager — per-unit actions", () => {
  it("approveUnit releases the held unit and its dependents", async () => {
    const flowId = await seedParentFlow(401);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] }), unit("c")], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.approveUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the approved join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done", "c:done"]);
  });

  it("retryUnit re-runs a failed unit; the previously blocked dependents proceed", async () => {
    const flowId = await seedParentFlow(402);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a", { item: { behavior: "fail-once" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the fail-once join");
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);

    await splitManager.retryUnit(flowId, "split_consumer_fixture", "a");
    await until(async () => (await consumerOf(flowId)).status === "done", "the retried join");

    expect(FixtureWorkerDef.runs.get("a")).toBe(2);
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
  });

  it("cancelUnit stops a held unit — it surfaces failed, dependents blocked", async () => {
    const flowId = await seedParentFlow(403);
    await setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.cancelUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the cancelled join");

    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);
  });

  it("skipUnit marks the unit skipped, blocks its dependents, and lets the rest proceed", async () => {
    const flowId = await seedParentFlow(404);
    await setUnits(flowId, [
      unit("a", { item: { behavior: "hold" } }),
      unit("b", { dependsOn: ["a"] }),
      unit("c"),
    ], "split_worker_fixture");

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.skipUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the skipped join");

    const consumer = await consumerOf(flowId);
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:skipped", "b:blocked", "c:done"]);
    // a deliberate skip is not a failure — the consumer still resolves (decision 4)
    expect(consumer.status).toBe("done");
  });
});

describe("SplitManager — guards", () => {
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
      childFlowId, taskId, "nested child", "active", "tpl_sdlc_loop", parentId, now(), now()
    );
    for (const [key, type, config] of [
      ["split_source_fixture", "split_source_fixture", JSON.stringify({ units: [unit("n")] })],
      ["split_consumer_fixture", "split_consumer_fixture", JSON.stringify({ split_consume: "per-unit" })],
    ] as const) {
      await db.run(
        `INSERT INTO nodes (id, flow_id, node_key, type, status, config, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'pending',$5::jsonb,$6,$7)`,
        `node_nested_${key}`, childFlowId, key, type, config, now(), now()
      );
    }

    expect(await splitManager.expand(childFlowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
    expect(await db.all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=$1`, childFlowId)).toHaveLength(0);
  });

  it("a cycle in the unit DAG fails the expansion loudly before any child row exists", async () => {
    const flowId = await seedParentFlow(502);
    await setUnits(flowId, [unit("a", { dependsOn: ["b"] }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .rejects.toThrow(/unit dependency cycle: a → b → a/);
    expect(await childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a source publishing no units never engages the manager", async () => {
    const flowId = await seedParentFlow(503);
    await setUnits(flowId, [], "split_worker_fixture"); // empty array

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
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

      expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
      expect(await childFlowsOf(flowId)).toHaveLength(0);
      expect((await consumerOf(flowId)).status).toBe("pending");
    }
  });
});

// ── Phase 4: the consumer knob (agent-node split plan §2.4) ──────────────────

describe("Phase 4 knob placement — every def config still parses to today's defaults", () => {
  it("AgentDefSchema defaults: split_consume whole, split_parallel_max 1 (zero behavior change)", () => {
    const def = AgentDefSchema.parse({});
    expect(def.split_consume).toBe("whole");
    expect(def.split_parallel_max).toBe(1);
    // the Phase-3 split block still parses beside the new knobs
    const withSplit = AgentDefSchema.parse({ split: { field: "services" } });
    expect(withSplit.split).toMatchObject({ field: "services", key_field: "key" });
  });

  it("the built-in consumer defs parse unchanged and carry the knob at whole", async () => {
    for (const defKey of [NODE_KEYS.BUILD, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE, NODE_KEYS.PIPELINE]) {
      const def = nodeRegistry.all().find((d) => d.key === defKey);
      if (!def) throw new Error(`builtin def ${defKey} is not registered`);
      const parsed = def.configSchema.parse({}) as Record<string, unknown>;
      // build defers to its plan source's published resolution (Phase 6);
      // the other built-in consumers keep today's whole default
      expect(parsed.split_consume).toBe(defKey === NODE_KEYS.BUILD ? "source" : "whole");
      expect(parsed.split_parallel_max).toBe(1);
    }
    // spot-check that pre-existing defaults survived the new keys
    const build = await nodeRegistry.resolve(NODE_KEYS.BUILD);
    expect((build.configSchema.parse({}) as Record<string, unknown>).max_commit_fix_attempts).toBe(2);
    const review = await nodeRegistry.resolve(NODE_KEYS.REVIEW);
    expect((review.configSchema.parse({}) as Record<string, unknown>).comment_style).toBe("inline");
  });

  it("the defensive readers bow out on garbage (never throw a run down)", () => {
    expect(splitConsumeOf({ split_consume: "nonsense" })).toBe("whole");
    expect(splitConsumeOf(null)).toBe("whole");
    expect(splitParallelMaxOf({ split_parallel_max: 0 })).toBe(1);
    expect(splitParallelMaxOf({ split_parallel_max: "2" })).toBe(1);
    expect(splitParallelMaxOf(null)).toBe(1);
    expect(splitParallelMaxOf({ split_parallel_max: 3.7 })).toBe(3);
  });
});

describe("Phase 4 knob layering — class defaults ← app settings ← flow snapshot", () => {
  const DEF = "split_consumer_fixture";
  const SETTINGS_KEY = `node_config.${DEF}`;

  it("each layer wins over the one below, for both split knobs", async () => {
    // the template snapshot carries NO split knob (the seed default's
    // `per-unit` is overridden with undefined, which drops the JSON key), so
    // the class layer shows through first
    const flowId = await seedParentFlow(601, {
      consumerConfig: { split_consume: undefined, split_parallel_max: undefined },
    });
    const configOf = async () => flowEngine.nodeConfigFor(flowId, DEF);
    try {
      // class layer: the fixture def declares no config defaults — the knob
      // is simply ABSENT, and the defensive reader the gate uses resolves it
      // to whole (the zero-behavior default)
      expect(splitConsumeOf(await configOf())).toBe("whole");
      // the app-settings layer wins over the class layer
      await db.setSetting(SETTINGS_KEY, { split_consume: "per-unit", split_parallel_max: 3 });
      expect(await configOf()).toMatchObject({ split_consume: "per-unit", split_parallel_max: 3 });
      expect(splitParallelMaxOf(await configOf())).toBe(3);
      // the flow snapshot layer wins over both
      await flowEngine.setNodeConfig(flowId, DEF, { split_consume: "source", split_parallel_max: 2 });
      expect(await configOf()).toMatchObject({ split_consume: "source", split_parallel_max: 2 });
      expect(splitParallelMaxOf(await configOf())).toBe(2);
    } finally {
      await db.setSetting(SETTINGS_KEY, null); // never leak app-layer knobs into other tests
    }
  });
});

describe("Phase 4 — the engine split gate", () => {
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
    expect(FixtureConsumerDef.wholeRuns).toBe(0); // the split manager owned the node
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
    await until(async () => (await consumerOf(flowId)).status === "done", "the wrapped whole run");

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

describe("Phase 4 — the per-unit actions resolve their consumer by unit key", () => {
  it("consumerOfUnit finds the owning consumer; unknown unit keys bow out", async () => {
    const flowId = await seedParentFlow(801);
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    expect(await splitManager.consumerOfUnit(flowId, "a")).toBe("split_consumer_fixture");
    expect(await splitManager.consumerOfUnit(flowId, "ghost")).toBeNull();
  });
});
