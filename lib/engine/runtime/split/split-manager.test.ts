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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Must run before any `db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-split-runtime-")),
  "test.db",
);

const { db } = await import("../../../db");
const { flowEngine } = await import("../../flow-engine");
const { splitManager } = await import("./split-manager");
const { NodeDefinition } = await import("../../nodes/shared/node-definition");
const { nodeRegistry } = await import("../../nodes/registry");
const { templateStore } = await import("../../templates/template-store");
const { agentPortRegistry } = await import("../../ports/agent-port");
const { AgentDefSchema } = await import("../../nodes/declarative-schemas");
const { NODE_KEYS } = await import("../../constants/node-keys");
const { splitConsumeOf, splitParallelMaxOf } = await import("../../nodes/shared/split");
import type {
  AgentPort,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "../../ports/agent-port";
import type { FlowCtx } from "../../nodes/shared";
import type { RunOutcome } from "../../nodes/shared/node-definition";
import type { SplitChildPayload } from "./split-manager";
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

  async getRun(): Promise<null> {
    return null;
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  hasActiveRun(): boolean {
    return false;
  }

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
db.setSetting("default_harness", "stub"); // forMode("cloud") selects the stub

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
    const payload = (ctx.flow.trigger_payload ?? {}) as { unit?: { key?: string; item?: WorkerItem } };
    const unitKey = payload.unit?.key ?? "?";
    FixtureWorkerDef.started.push(unitKey);
    const count = (FixtureWorkerDef.runs.get(unitKey) ?? 0) + 1;
    FixtureWorkerDef.runs.set(unitKey, count);
    const node = this.support.nodeByKey(ctx.flow.id, this.key);
    this.support.setNode(node.id, { status: "running" });
    this.recordInput(node.id, { unitKey });
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
  readonly key = "split_source_fixture";
  readonly label = "Split source fixture";
  readonly promptKeys = [];
  readonly order = 901;
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.record(z.string(), z.unknown());
  /** the units and the §2.4 resolution recommendation, both from the node row */
  protected knobs(ctx: FlowCtx): { units: unknown; resolution: unknown } {
    const cfg = this.nodeConfig(ctx);
    return { units: cfg.units, resolution: cfg.resolution };
  }

  splitUnits(ctx: FlowCtx): SplitUnit[] | null {
    const units = this.knobs(ctx).units;
    return Array.isArray(units) ? (units as SplitUnit[]) : null;
  }

  /**
   * The Phase-4 recommendation port, driven by the node's `resolution` knob:
   * "per-unit" | "whole" | unset (no recommendation).
   */
  splitResolution(ctx: FlowCtx): "whole" | "per-unit" | null {
    const v = this.knobs(ctx).resolution;
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
  override readonly key: string = "split_source_fixture_b";
  override readonly label: string = "Split source fixture B";
  override readonly order: number = 903;
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
  readonly capabilities = { splitOutput: CONSUMER_AGGREGATE };
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.record(z.string(), z.unknown());

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
function seedCatalogRow(index: number, key: string, name: string): void {
  db.run(
    `INSERT OR IGNORE INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
     VALUES (?,?,?,'builtin',1,?,NULL,'{}',1,?,?)`,
    `nt_${key}_${index}`, key, name, `fixture catalog row ${name}`, now(), now()
  );
}
seedCatalogRow(1, "split_worker_fixture", "Split worker fixture");
seedCatalogRow(1, "split_source_fixture", "Split source fixture");
seedCatalogRow(1, "split_consumer_fixture", "Split consumer fixture");
// a second SOURCE def for the multi-source conflict test (catalog keys are
// UNIQUE(key, version) — the second source needs its own def + row)
seedCatalogRow(1, "split_source_fixture_b", "Split source fixture B");

/** The `template` targets — declarative agent rows (resolved by row id, the
 *  Phase-1 lookup). The contract row declares a start contract the unit item
 *  must match (the compatibility check). */
const DECL_ROW = must(
  templateStore.createNodeTemplate({
    key: "unit_worker_decl",
    name: "Unit worker declarative",
    kind: "agent",
    config: { mode: "plan", output: "markdown", prompt: "Process the unit {{input.unit.key}} — {{input.unit.item.summary}}" },
  }),
  "declarative agent row"
);
const DECL_ROW_CONTRACT = must(
  templateStore.createNodeTemplate({
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
function seedParentFlow(
  index: number,
  opts: { consumerConfig?: Record<string, unknown> } = {},
): string {
  const tplId = templateStore.create({
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
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "jira", `SPL-${index}`, "split runtime test", "open", "task", "P2"
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `split fixture ${index}`, { templateId: tplId });
}

function setUnits(flowId: string, units: SplitUnit[], target?: string): void {
  flowEngine.setNodeConfig(flowId, "split_source_fixture", {
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
function childFlowsOf(flowId: string): { id: string; unitKey: string; payload: SplitChildPayload }[] {
  return db.all<{ id: string; trigger_payload: string | null }>(
    `SELECT id, trigger_payload FROM flows WHERE parent_flow_id=? AND kind='split' ORDER BY created_at, id`,
    flowId
  ).map((r) => {
    const payload = must(
      r.trigger_payload ? (JSON.parse(r.trigger_payload) as SplitChildPayload) : undefined,
      `split payload of child ${r.id}`
    );
    return { id: r.id, unitKey: payload.unit.key, payload };
  });
}

interface AggregateEntry { key: string; title: string; status: string; output?: unknown }

/** The consumer node's status + parsed aggregate output. */
function consumerOf(flowId: string): { status: string; units: AggregateEntry[] } {
  const row = must(
    db.get<{ status: string; output: string | null }>(
      `SELECT status, output FROM nodes WHERE flow_id=? AND node_key='split_consumer_fixture'`, flowId
    ),
    `consumer node of ${flowId}`
  );
  const output = row.output ? (JSON.parse(row.output) as { units?: AggregateEntry[] }) : {};
  return { status: row.status, units: output.units ?? [] };
}

/** Poll the DB until the async engine bg work settles (or fail loudly). */
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const joinSettled = (flowId: string) => () => {
  const c = consumerOf(flowId);
  return c.units.length > 0 && c.units.every((u) => ["done", "failed", "blocked", "skipped", "awaiting_approval"].includes(u.status));
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("SplitManager — expansion", () => {
  it("creates one child flow per unit; the payload carries the linkage (parentNodeKey + unit)", async () => {
    const flowId = seedParentFlow(101);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a"), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);

    const children = childFlowsOf(flowId);
    expect(children.map((c) => c.unitKey)).toEqual(["a", "b"]);
    expect(children[0].payload).toMatchObject({
      parentNodeKey: "split_consumer_fixture",
      unit: { key: "a", title: "unit a", dependsOn: [], item: { key: "a" }, position: 0 },
    });
    expect(children[1].payload.unit.dependsOn).toEqual(["a"]);
    await until(joinSettled(flowId), "the node-target join"); // the consumer holds while units run
    expect(consumerOf(flowId).status).toBe("done");
  });

  it("a `template` target runs the declarative row; the unit rides {{input.unit.*}}", async () => {
    const flowId = seedParentFlow(102);
    setUnits(flowId, [unit("a"), unit("b")], DECL_ROW.id);

    expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    await until(joinSettled(flowId), "the template-target join");

    expect(consumerOf(flowId).status).toBe("done");
    expect(consumerOf(flowId).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    // the child's agent prompt rendered the unit through {{input.unit.*}}
    expect(stubPort.prompts.some((p) => p.includes("Process the unit a — item a"))).toBe(true);
    expect(stubPort.prompts.some((p) => p.includes("Process the unit b — item b"))).toBe(true);
  });

  it("a unit.item outside the template target's start contract fails expansion loudly (no child rows)", () => {
    const flowId = seedParentFlow(103);
    setUnits(flowId, [unit("a", { item: { key: "a" } })], DECL_ROW_CONTRACT.id); // missing "service"

    expect(() => splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .toThrow(/doesn't match the target template/);
    expect(childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a `node` target auto-wraps the node into a single-unit child template", async () => {
    const flowId = seedParentFlow(104);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("n1")], "split_worker_fixture"); // registry key, not a row id

    expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    await until(joinSettled(flowId), "the node-target join");

    expect(consumerOf(flowId).status).toBe("done");
    const child = must(childFlowsOf(flowId)[0], "node-target child");
    const childTpl = db.get<{ name: string; hidden: number }>(
      `SELECT f.name, f.hidden FROM flow_templates f JOIN flows c ON c.template_id=f.id WHERE c.id=?`, child.id
    );
    expect(childTpl?.name).toBe("Split worker fixture · unit"); // the auto-wrapped graph
    expect(childTpl?.hidden).toBe(1);
    expect(FixtureWorkerDef.started).toEqual(["n1"]);
  });

  it("unit.target overrides the split config default (heterogeneous routing)", async () => {
    const flowId = seedParentFlow(105);
    FixtureWorkerDef.reset();
    setUnits(flowId, [
      unit("t", { target: DECL_ROW.id }), // delivery template
      unit("n"), // default target = the node target set below
    ], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the mixed-target join");

    expect(consumerOf(flowId).status).toBe("done");
    const children = childFlowsOf(flowId);
    const tplOf = (childId: string) =>
      db.get<{ name: string }>(
        `SELECT f.name FROM flow_templates f JOIN flows c ON c.template_id=f.id WHERE c.id=?`, childId
      )?.name;
    expect(tplOf(must(children.find((c) => c.unitKey === "t"), "child t").id)).toBe("Unit worker declarative · unit");
    expect(tplOf(must(children.find((c) => c.unitKey === "n"), "child n").id)).toBe("Split worker fixture · unit");
    expect(stubPort.prompts.some((p) => p.includes("Process the unit t"))).toBe(true);
    expect(FixtureWorkerDef.started).toEqual(["n"]);
  });

  it("re-expansion reconciles: new units get children, unchanged units keep theirs", async () => {
    const flowId = seedParentFlow(106);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");
    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the first join");
    const first = childFlowsOf(flowId);

    // a plan refinement adds a unit — a and b must keep their child flows
    setUnits(flowId, [unit("a"), unit("b"), unit("c")], "split_worker_fixture");
    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(() => childFlowsOf(flowId).length === 3, "the third child");
    await until(() => consumerOf(flowId).units.length === 3, "the re-join");

    const second = childFlowsOf(flowId);
    const idOf = (cs: typeof second, key: string) => must(cs.find((c) => c.unitKey === key), `child ${key}`).id;
    expect(idOf(second, "a")).toBe(idOf(first, "a")); // never recreated
    expect(idOf(second, "b")).toBe(idOf(first, "b"));
    expect(FixtureWorkerDef.started.filter((k) => k === "a")).toHaveLength(1); // not re-run either
    expect(consumerOf(flowId).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done", "c:done"]);
  });
});

describe("SplitManager — scheduling (deps + slot)", () => {
  it("parallel_max 1: a later independent unit yields to an earlier dependent", async () => {
    const flowId = seedParentFlow(201);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the serial join");

    // b (no deps) waits twice: behind a's slot, then behind c (earlier position)
    expect(FixtureWorkerDef.started).toEqual(["a", "c", "b"]);
    expect(consumerOf(flowId).units.map((u) => u.status)).toEqual(["done", "done", "done"]);
  });

  it("parallel_max 2: independents start together (no file-overlap inference)", async () => {
    const flowId = seedParentFlow(202, { consumerConfig: { split_parallel_max: 2 } });
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the parallel join");

    // the free slot lets b start beside a, before its dependent c
    expect(FixtureWorkerDef.started).toEqual(["a", "b", "c"]);
  });

  it("a unit depending on an unknown key never starts — it surfaces blocked, the join still publishes", async () => {
    const flowId = seedParentFlow(203);
    setUnits(flowId, [unit("a", { dependsOn: ["ghost"] })], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the ghost-dep join");

    expect(consumerOf(flowId).units).toEqual([
      expect.objectContaining({ key: "a", status: "blocked" }),
    ]);
  });
});

describe("SplitManager — failure semantics + join", () => {
  it("a failed unit blocks its dependents; non-dependents proceed; the join surfaces it all", async () => {
    const flowId = seedParentFlow(301);
    FixtureWorkerDef.reset();
    setUnits(flowId, [
      unit("a", { item: { behavior: "fail" } }),
      unit("c", { dependsOn: ["a"] }),
      unit("b"),
    ], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the failed join");

    const consumer = consumerOf(flowId);
    expect(consumer.status).toBe("failed"); // worst-of (decision 4)
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "c:blocked", "b:done"]);
    // the blocked dependent was never started
    const cChild = must(childFlowsOf(flowId).find((c) => c.unitKey === "c"), "child c");
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, cChild.id)?.status).toBe("pending");
    expect(FixtureWorkerDef.started).toEqual(["a", "b"]);
  });

  it("the aggregate publishes in unit order (positions), not completion order", async () => {
    const flowId = seedParentFlow(302, { consumerConfig: { split_parallel_max: 3 } });
    setUnits(flowId, [unit("z"), unit("m"), unit("a")], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the ordered join");

    expect(consumerOf(flowId).units.map((u) => u.key)).toEqual(["z", "m", "a"]);
  });
});

describe("SplitManager — per-unit actions", () => {
  it("approveUnit releases the held unit and its dependents", async () => {
    const flowId = seedParentFlow(401);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] }), unit("c")], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(() => consumerOf(flowId).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    splitManager.approveUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the approved join");

    const consumer = consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done", "c:done"]);
  });

  it("retryUnit re-runs a failed unit; the previously blocked dependents proceed", async () => {
    const flowId = seedParentFlow(402);
    FixtureWorkerDef.reset();
    setUnits(flowId, [unit("a", { item: { behavior: "fail-once" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the fail-once join");
    expect(consumerOf(flowId).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);

    splitManager.retryUnit(flowId, "split_consumer_fixture", "a");
    await until(() => consumerOf(flowId).status === "done", "the retried join");

    expect(FixtureWorkerDef.runs.get("a")).toBe(2);
    expect(consumerOf(flowId).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
  });

  it("cancelUnit stops a held unit — it surfaces failed, dependents blocked", async () => {
    const flowId = seedParentFlow(403);
    setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(() => consumerOf(flowId).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.cancelUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the cancelled join");

    expect(consumerOf(flowId).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);
  });

  it("skipUnit marks the unit skipped, blocks its dependents, and lets the rest proceed", async () => {
    const flowId = seedParentFlow(404);
    setUnits(flowId, [
      unit("a", { item: { behavior: "hold" } }),
      unit("b", { dependsOn: ["a"] }),
      unit("c"),
    ], "split_worker_fixture");

    splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(() => consumerOf(flowId).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.skipUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the skipped join");

    const consumer = consumerOf(flowId);
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:skipped", "b:blocked", "c:done"]);
    // a deliberate skip is not a failure — the consumer still resolves (decision 4)
    expect(consumer.status).toBe("done");
  });
});

describe("SplitManager — guards", () => {
  it("nesting guard: a per-unit consumer inside a child flow resolves whole", () => {
    // a child flow (parent_flow_id set) carrying a per-unit consumer + source
    const parentId = seedParentFlow(501);
    const taskId = `task_nested_501`;
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "jira", `SPL-501-NESTED`, "nested", "open", "task", "P2"
    );
    const childFlowId = `flw_nested_501`;
    db.run(
      `INSERT INTO flows (id, task_id, name, status, template_id, parent_flow_id, kind, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'split',?,?)`,
      childFlowId, taskId, "nested child", "active", "tpl_sdlc_loop", parentId, now(), now()
    );
    for (const [key, type, config] of [
      ["split_source_fixture", "split_source_fixture", JSON.stringify({ units: [unit("n")] })],
      ["split_consumer_fixture", "split_consumer_fixture", JSON.stringify({ split_consume: "per-unit" })],
    ] as const) {
      db.run(
        `INSERT INTO nodes (id, flow_id, node_key, type, status, config, created_at, updated_at)
         VALUES (?,?,?,?,'pending',?,?,?)`,
        `node_nested_${key}`, childFlowId, key, type, config, now(), now()
      );
    }

    expect(splitManager.expand(childFlowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
    expect(db.all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=?`, childFlowId)).toHaveLength(0);
  });

  it("a cycle in the unit DAG fails the expansion loudly before any child row exists", () => {
    const flowId = seedParentFlow(502);
    setUnits(flowId, [unit("a", { dependsOn: ["b"] }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    expect(() => splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture"))
      .toThrow(/unit dependency cycle: a → b → a/);
    expect(childFlowsOf(flowId)).toHaveLength(0);
  });

  it("a source publishing no units never engages the manager", () => {
    const flowId = seedParentFlow(503);
    setUnits(flowId, [], "split_worker_fixture"); // empty array

    expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
    expect(childFlowsOf(flowId)).toHaveLength(0);
    expect(consumerOf(flowId).status).toBe("pending"); // untouched
  });

  it("split_consume whole (or absent) never engages the manager", () => {
    // `{split_consume: undefined}` drops the key in the stored JSON — the
    // absent case; `{split_consume: "whole"}` the explicit one
    for (const [index, config] of [
      [504, { split_consume: undefined }],
      [505, { split_consume: "whole" }],
    ] as const) {
      const flowId = seedParentFlow(index, { consumerConfig: config });
      setUnits(flowId, [unit("a")], "split_worker_fixture");

      expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(false);
      expect(childFlowsOf(flowId)).toHaveLength(0);
      expect(consumerOf(flowId).status).toBe("pending");
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

  it("the built-in consumer defs parse unchanged and carry the knob at whole", () => {
    for (const defKey of [NODE_KEYS.BUILD, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE, NODE_KEYS.PIPELINE]) {
      const def = nodeRegistry.all().find((d) => d.key === defKey);
      if (!def) throw new Error(`builtin def ${defKey} is not registered`);
      const parsed = def.configSchema.parse({}) as Record<string, unknown>;
      expect(parsed.split_consume).toBe("whole"); // the default IS today's behavior
      expect(parsed.split_parallel_max).toBe(1);
    }
    // spot-check that pre-existing defaults survived the new keys
    const build = nodeRegistry.resolve(NODE_KEYS.BUILD);
    expect((build.configSchema.parse({}) as Record<string, unknown>).max_commit_fix_attempts).toBe(2);
    const review = nodeRegistry.resolve(NODE_KEYS.REVIEW);
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

  it("each layer wins over the one below, for both split knobs", () => {
    // the template snapshot carries NO split knob (the seed default's
    // `per-unit` is overridden with undefined, which drops the JSON key), so
    // the class layer shows through first
    const flowId = seedParentFlow(601, {
      consumerConfig: { split_consume: undefined, split_parallel_max: undefined },
    });
    const configOf = () => flowEngine.nodeConfigFor(flowId, DEF);
    try {
      // class layer: the fixture def declares no config defaults — the knob
      // is simply ABSENT, and the defensive reader the gate uses resolves it
      // to whole (the zero-behavior default)
      expect(splitConsumeOf(configOf())).toBe("whole");
      // the app-settings layer wins over the class layer
      db.setSetting(SETTINGS_KEY, { split_consume: "per-unit", split_parallel_max: 3 });
      expect(configOf()).toMatchObject({ split_consume: "per-unit", split_parallel_max: 3 });
      expect(splitParallelMaxOf(configOf())).toBe(3);
      // the flow snapshot layer wins over both
      flowEngine.setNodeConfig(flowId, DEF, { split_consume: "source", split_parallel_max: 2 });
      expect(configOf()).toMatchObject({ split_consume: "source", split_parallel_max: 2 });
      expect(splitParallelMaxOf(configOf())).toBe(2);
    } finally {
      db.setSetting(SETTINGS_KEY, null); // never leak app-layer knobs into other tests
    }
  });
});

describe("Phase 4 — the engine split gate", () => {
  it("per-unit via the gate: the source run activates the consumer, children expand, the join publishes, the whole path never runs", async () => {
    const flowId = seedParentFlow(701);
    FixtureWorkerDef.reset();
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    flowEngine.start(flowId);
    await until(() => childFlowsOf(flowId).length === 2, "the gate expansion");
    await until(joinSettled(flowId), "the gate join");

    const consumer = consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
    expect(FixtureConsumerDef.wholeRuns).toBe(0); // the split manager owned the node
  });

  it("explicit whole is byte-identical: the def runs once, no children, no aggregate", async () => {
    const flowId = seedParentFlow(702, { consumerConfig: { split_consume: "whole" } });
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a")], "split_worker_fixture");

    flowEngine.start(flowId);
    await until(() => consumerOf(flowId).status === "done", "the whole run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(childFlowsOf(flowId)).toHaveLength(0);
    const row = db.get<{ output: string | null }>(
      `SELECT output FROM nodes WHERE flow_id=? AND node_key='split_consumer_fixture'`, flowId
    );
    expect(JSON.parse(row?.output ?? "{}")).toEqual({ whole: true });
  });

  it("source mode honors splitResolution: a per-unit recommendation expands", async () => {
    const flowId = seedParentFlow(703, { consumerConfig: { split_consume: "source" } });
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");
    flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "per-unit" });

    flowEngine.start(flowId);
    await until(joinSettled(flowId), "the recommended join");

    expect(consumerOf(flowId).status).toBe("done");
    expect(childFlowsOf(flowId)).toHaveLength(2);
    expect(FixtureConsumerDef.wholeRuns).toBe(0);
  });

  it("source mode with no recommendation (or a whole one) consumes whole", async () => {
    for (const [index, resolution] of [[704, undefined], [705, "whole"]] as const) {
      const flowId = seedParentFlow(index, { consumerConfig: { split_consume: "source" } });
      FixtureConsumerDef.reset();
      setUnits(flowId, [unit("a")], "split_worker_fixture");
      if (resolution) flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution });

      flowEngine.start(flowId);
      await until(() => consumerOf(flowId).status === "done", `the ${resolution ?? "unrecommended"} whole run`);
      expect(FixtureConsumerDef.wholeRuns).toBe(1);
      expect(childFlowsOf(flowId)).toHaveLength(0);
    }
  });

  it("explicit consumer choice wins over the recommendation, both ways", async () => {
    // per-unit consumer over a whole recommendation → expands
    let flowId = seedParentFlow(706, { consumerConfig: { split_consume: "per-unit" } });
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a")], "split_worker_fixture");
    flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "whole" });
    flowEngine.start(flowId);
    await until(joinSettled(flowId), "the overridden join");
    expect(childFlowsOf(flowId)).toHaveLength(1);
    expect(FixtureConsumerDef.wholeRuns).toBe(0);

    // whole consumer over a per-unit recommendation → today's path
    flowId = seedParentFlow(707, { consumerConfig: { split_consume: "whole" } });
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a")], "split_worker_fixture");
    flowEngine.setNodeConfig(flowId, "split_source_fixture", { resolution: "per-unit" });
    flowEngine.start(flowId);
    await until(() => consumerOf(flowId).status === "done", "the whole-over-recommendation run");
    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(childFlowsOf(flowId)).toHaveLength(0);
  });

  it("per-unit with no published units falls through to the whole path", async () => {
    const flowId = seedParentFlow(708);
    FixtureConsumerDef.reset();
    setUnits(flowId, [], "split_worker_fixture");

    flowEngine.start(flowId);
    await until(() => consumerOf(flowId).status === "done", "the fall-through run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(childFlowsOf(flowId)).toHaveLength(0);
  });

  it("conflict: a node whose fan-out knob engaged keeps the fan-out behavior", async () => {
    // fanout_mode "from-plan" resolves whole → the fan-out gate claims the
    // node (whole-wrap); the split knob is ignored and the whole path runs
    const flowId = seedParentFlow(709, { consumerConfig: { fanout_mode: "from-plan", split_consume: "per-unit" } });
    FixtureConsumerDef.reset();
    setUnits(flowId, [unit("a")], "split_worker_fixture");

    flowEngine.start(flowId);
    await until(() => consumerOf(flowId).status === "done", "the wrapped whole run");

    expect(FixtureConsumerDef.wholeRuns).toBe(1);
    expect(childFlowsOf(flowId)).toHaveLength(0);
    const row = db.get<{ output: string | null }>(
      `SELECT output FROM nodes WHERE flow_id=? AND node_key='split_consumer_fixture'`, flowId
    );
    const out = JSON.parse(row?.output ?? "{}") as { steps?: { id: string }[] };
    expect(out.steps?.[0]?.id).toBe("whole"); // the fan-out whole-wrap ran, not the split join
  });

  it("several upstream sources fail the consumer loudly (never a silent pick)", async () => {
    const tplId = templateStore.create({
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
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "jira", "SPL-710", "two sources", "open", "task", "P2"
    );
    const flowId = flowEngine.create(taskId, "https://git.example.com/o/r", "two sources", { templateId: tplId });
    flowEngine.start(flowId);

    await until(() => consumerOf(flowId).status === "failed", "the multi-source failure");
    const errors = db.all<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=? AND type='error'`, flowId
    );
    expect(errors.some((e) => e.message?.includes("several upstream nodes publish"))).toBe(true);
  });
});

describe("Phase 4 — the per-unit actions resolve their consumer by unit key", () => {
  it("consumerOfUnit finds the owning consumer; unknown unit keys bow out", () => {
    const flowId = seedParentFlow(801);
    setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    expect(splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    expect(splitManager.consumerOfUnit(flowId, "a")).toBe("split_consumer_fixture");
    expect(splitManager.consumerOfUnit(flowId, "ghost")).toBeNull();
  });
});
