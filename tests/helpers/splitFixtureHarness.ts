/**
 * Shared fixture harness for the split-runtime co-located tests (step 07
 * decomposition of the former single `splitManager.test.ts`) — a fixture
 * source + fixture consumer + fixture targets against the real engine and
 * real child-flow rows, plus the seeding/polling helpers every split test
 * file drives its scenarios through.
 *
 * Targets: a `node` target (the fixture worker, a builtin-style def) and a
 * `template` target (a declarative agent row, run through a stub agent port
 * so no runtime is contacted) — the two kinds the Phase-1 lookup resolves.
 *
 * Runs against the isolated test database: DATABASE_URL is assigned before
 * the first `db` import isolates the client (AGENTS.md §1 — never a
 * demo/real database). Call `setupSplitFixtures()` from each test file's
 * `beforeAll` (truncate + re-seed).
 */
import { assignTestDatabase } from "./testDatabase";
import { z } from "zod";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { splitManager } = await import("@/lib/engine/runtime/split/splitManager");
const { NodeDefinition } = await import("@/lib/engine/nodes/shared/nodeDefinition");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { agentPortRegistry } = await import("@/lib/engine/ports/agentPort");
const { AgentDefSchema } = await import("@/lib/engine/nodes/declarativeSchemas");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");
const { splitConsumeOf, splitParallelMaxOf } = await import("@/lib/engine/nodes/shared/split");
const { engineParts } = await import("@/lib/composition/container");
const { resetTestDatabase } = await import("./testDatabase");
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "@/lib/engine/ports/agentPort";
import type { FlowCtx } from "@/lib/engine/nodes/shared/nodeSharedExports";
import type { RunOutcome } from "@/lib/engine/nodes/shared/nodeDefinition";
import type { RecoveryResult } from "@/lib/engine/nodes/shared/types/recovery";
import type { SplitChildPayload } from "@/lib/engine/runtime/split/types/splitChildPayload";
import type { SplitUnit } from "@/lib/engine/nodes/shared/split";

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
const must = <T>(row: T | undefined, what: string): T => {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
};

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
    // the engine's stage claim already holds the node running — record only
    // the input (status writes belong to the transition authority, step 02)
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

  async recover(): Promise<RecoveryResult> {
    return { kind: "manual", reason: "fixture never recovers" };
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

  async recover(): Promise<RecoveryResult> {
    return { kind: "manual", reason: "fixture never recovers" };
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

  async recover(): Promise<RecoveryResult> {
    return { kind: "manual", reason: "fixture never recovers" };
  }
}

for (const def of [new FixtureWorkerDef(), new FixtureSourceDef(), new FixtureSourceDefB(), new FixtureConsumerDef()]) {
  if (!nodeRegistry.has(def.key)) nodeRegistry.register(def);
}

/** Built-in-style catalog rows so templates can instance the fixture defs. */
const seedCatalogRow = async (index: number, key: string, name: string): Promise<void> => {
  await db.run(
    `INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
     VALUES ($1,$2,$3,'builtin',1,$4,NULL,'{}'::jsonb,true,$5,$6)
     ON CONFLICT DO NOTHING`,
    `nt_${key}_${index}`, key, name, `fixture catalog row ${name}`, now(), now()
  );
};

/**
 * The `template` targets — declarative agent rows (resolved by row id, the
 * Phase-1 lookup). The contract row declares a start contract the unit item
 * must match (the compatibility check).
 */
let DECL_ROW: { id: string };
let DECL_ROW_CONTRACT: { id: string };

/** Reset the shared test database and seed the fixture catalog rows +
 *  declarative target rows the tests reference. Call from each DB-touching
 *  test file's `beforeAll`. */
export const setupSplitFixtures = async (): Promise<void> => {
  await resetTestDatabase();
  await seedCatalogRow(1, "split_worker_fixture", "Split worker fixture");
  await seedCatalogRow(1, "split_source_fixture", "Split source fixture");
  await seedCatalogRow(1, "split_consumer_fixture", "Split consumer fixture");
  // a second SOURCE def for the multi-source conflict test (catalog keys are
  // UNIQUE(key, version) — the second source needs its own def + row)
  await seedCatalogRow(1, "split_source_fixture_b", "Split source fixture B");
  DECL_ROW = must(
    await templateStore.createNodeTemplate({
      key: "unit_worker_decl",
      name: "Unit worker declarative",
      kind: "agent",
      config: { mode: "plan", output: "markdown", prompt: "Process the unit {{input.unit.key}} — {{input.unit.item.summary}}" },
    }),
    "declarative agent row"
  );
  DECL_ROW_CONTRACT = must(
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
};

/** The declarative `template` target row (assigned by `setupSplitFixtures`). */
export const declRow = (): { id: string } => DECL_ROW;
/** The declarative `template` target row carrying a start contract. */
export const declRowContract = (): { id: string } => DECL_ROW_CONTRACT;

// ── seeding + polling helpers ────────────────────────────────────────────────

/** One isolated parent flow on a fixture template: source → consumer. The
 *  consumer is per-unit unless overridden; the source's default target and
 *  units are set per test via `setUnits`. */
export const seedParentFlow = async (
  index: number,
  opts: { consumerConfig?: Record<string, unknown> } = {},
): Promise<string> => {
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
};

export const setUnits = async (flowId: string, units: SplitUnit[], target?: string): Promise<void> => {
  await flowEngine.setNodeConfig(flowId, "split_source_fixture", {
    ...(target ? { split_target: target } : {}),
    units,
  });
};

export const unit = (key: string, opts: { dependsOn?: string[]; target?: string; item?: unknown } = {}): SplitUnit => ({
  key,
  title: `unit ${key}`,
  dependsOn: opts.dependsOn ?? [],
  ...(opts.target ? { target: opts.target } : {}),
  item: opts.item ?? { key, summary: `item ${key}` },
});

/** The parent's split children (the derived linkage), in expansion order. */
export const childFlowsOf = async (flowId: string): Promise<{ id: string; unitKey: string; payload: SplitChildPayload }[]> => {
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
};

interface AggregateEntry { key: string; title: string; status: string; output?: unknown }

/** The consumer node's status + parsed aggregate output. */
export const consumerOf = async (flowId: string): Promise<{ status: string; units: AggregateEntry[] }> => {
  const row = must(
    await db.get<{ status: string; output: unknown }>(
      `SELECT status, output FROM nodes WHERE flow_id=$1 AND node_key='split_consumer_fixture'`, flowId
    ),
    `consumer node of ${flowId}`
  );
  const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
  const output = (parsed ?? {}) as { units?: AggregateEntry[] };
  return { status: row.status, units: output.units ?? [] };
};

/** Poll the DB until the async engine bg work settles (or fail loudly). */
export const until = async (cond: () => boolean | Promise<boolean>, what: string): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

export const joinSettled = (flowId: string) => async () => {
  const c = await consumerOf(flowId);
  return c.units.length > 0 && c.units.every((u) => ["done", "failed", "blocked", "skipped", "awaiting_approval"].includes(u.status));
};

/** The production precondition for a direct `expand` call: the engine's
 *  stage claim holds the consumer running first (StageRunner.startNodeStage
 *  claims, then expands). The declared claim is a no-op when the consumer is
 *  already engaged (re-expansion fixtures call expand repeatedly). */
export const engageConsumer = async (flowId: string): Promise<void> => {
  try {
    await engineParts.transitions.claim(flowId, "split_consumer_fixture", "runFromPending");
  } catch {
    // already running — the stage claim owns the attempt
  }
};

export {
  db,
  flowEngine,
  engineParts,
  splitManager,
  templateStore,
  nodeRegistry,
  stubPort,
  AgentDefSchema,
  NODE_KEYS,
  splitConsumeOf,
  splitParallelMaxOf,
  FixtureWorkerDef,
  FixtureConsumerDef,
  must,
};
