/**
 * Agent-node split plan, Phase 5 — the declarative smoke template (§6 first
 * bullet, §7 item 5): the template-library shape of the full split loop,
 * exercised through the SAME authoring path a user drives —
 * `templateStore.createNodeTemplate` + `templateStore.create` (template-lint
 * runs on save, so a lint failure IS a test failure) — then a real flow run:
 *
 *   scope_splitter (json agent, split: units → smoke_unit_worker)
 *     → smoke_unit_worker (agent, split_consume: "per-unit", parallel_max 2)
 *       → smoke_rollup (agent, consumes the aggregate whole)
 *
 * The stub agent port answers the splitter's output-contract directive with a
 * fixed 3-unit payload (one declared dependency) and everything else with
 * markdown, so the run is hermetic end-to-end: source publishes units → the
 * consumer expands per-unit children → the declared dependency gates
 * scheduling → the join publishes the aggregate in unit order → the parent
 * continues.
 *
 * Runs against an isolated temp SQLite DB (DATABASE_PATH is read lazily by
 * lib/config.ts — AGENTS.md §1, never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-split-smoke-")),
  "test.db",
);

const { db } = await import("../../db/app");
const { flowEngine } = await import("../flowEngine");
const { templateStore } = await import("./templateStore");
const { agentPortRegistry } = await import("../ports/agentPort");
import type {
  AgentPort,
  AgentRunHandle,
  AgentRunQuery,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "../ports/agentPort";

// ── stub agent port (hermetic runs; records every start prompt in order) ─────

/** The unit payload the stub splitter answers with — 3 units, one declared
 *  dependency (interface → foundation) so the scheduling demo is visible. */
const STUB_UNITS = {
  units: [
    {
      key: "foundation",
      title: "Foundation schema",
      dependsOn: [],
      scope: "Draft the shared data model the other units build on.",
    },
    {
      key: "interface",
      title: "Public interface",
      dependsOn: ["foundation"],
      scope: "Design the API surface on top of the foundation schema.",
    },
    {
      key: "rollout",
      title: "Rollout notes",
      dependsOn: [],
      scope: "Write the rollout/communication notes.",
    },
  ],
};

class SmokeAgentPort implements AgentPort {
  readonly kind = "smoke-stub";
  readonly label = "Smoke stub";
  readonly execMode = "cloud" as const;
  readonly harness = "smoke-stub";
  readonly fallbackModels = [];
  readonly listDiscount = 0;
  /** start prompts in call order — the scheduling-order journal */
  readonly prompts: string[] = [];
  private readonly promptByRun = new Map<string, string>();
  private counter = 0;

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    this.prompts.push(spec.prompt);
    this.counter += 1;
    const runId = `run_smoke_${this.counter}`;
    this.promptByRun.set(runId, spec.prompt);
    return { agentId: `agt_smoke_${this.counter}`, runId };
  }

  /** The splitter (output=json) gets the contract directive and answers with
   *  the unit payload; every other run answers markdown. */
  async stream(handle: AgentRunHandle): Promise<AgentStreamOutcome> {
    const prompt = this.promptByRun.get(handle.runId) ?? "";
    const result = prompt.includes("RESPONSE FORMAT")
      ? JSON.stringify(STUB_UNITS)
      : "Smoke stub markdown output";
    return { result: { status: "finished", result } };
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

const stubPort = new SmokeAgentPort();
agentPortRegistry.register(stubPort);
db.setSetting("default_harness", "smoke-stub"); // forMode("cloud") selects the stub

// ── the smoke template, authored exactly as a user would ─────────────────────

/** The declarative node templates (the Library rows the template instances). */
const SPLITTER_CONFIG = {
  mode: "plan",
  output: "json",
  prompt:
    "Scope splitter — split the work for task {{task.key}} — {{task.summary}} into independent units.\n\n"
    + "Produce exactly three units:\n"
    + "1. \"foundation\" — the shared groundwork every other unit builds on (no dependencies).\n"
    + "2. \"interface\" — the public API surface, declared dependent on \"foundation\" (dependsOn: [\"foundation\"]).\n"
    + "3. \"rollout\" — the rollout/communication notes, independent of both (no dependencies).\n"
    + "Give every unit a one-line `scope` describing what its worker should produce, and a short plain-words `title`.",
  output_schema: {
    type: "object",
    required: ["units"],
    properties: {
      units: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          required: ["key", "title"],
          properties: {
            key: { type: "string", description: "stable unit id (kebab-case)" },
            title: { type: "string", description: "short plain-words unit title" },
            dependsOn: {
              type: "array",
              items: { type: "string" },
              description: "keys of units this one must wait for",
            },
            scope: { type: "string", description: "one-line scope for the unit worker" },
          },
        },
      },
    },
  },
  // the split source knob (agent-node split plan §2.2): units fan out to the
  // consumer node template, matched by its catalog key
  split: {
    field: "units",
    key_field: "key",
    depends_on_field: "dependsOn",
    target: "smoke_unit_worker",
  },
};

const WORKER_CONFIG = {
  mode: "plan",
  output: "markdown",
  // the consumer knobs (§2.4): per-unit with a 2-slot budget — independents
  // start together, the declared dependency still gates its dependent
  split_consume: "per-unit",
  split_parallel_max: 2,
  prompt:
    "You are ONE unit of a split flow.\n"
    + "Unit: {{input.unit.title}} (key: {{input.unit.key}})\n"
    + "Scope: {{input.unit.item.scope}}\n"
    + "Declared dependencies: {{input.unit.dependsOn}}\n\n"
    + "Write a short markdown note: what this unit delivers, the interface contract other units must honor, and one risk. Under 120 words.",
};

const ROLLUP_CONFIG = {
  mode: "plan",
  output: "markdown",
  prompt:
    "All units of the split have resolved. The per-unit aggregate for task {{task.key}} — {{task.summary}}:\n\n{{input.units}}\n\n"
    + "Write a one-paragraph rollup: which units delivered, what the dependency chain produced, and anything a human should look at. Markdown.",
};

const SPLITTER_ROW = templateStore.createNodeTemplate({
  key: "smoke_scope_splitter",
  name: "Scope splitter (smoke)",
  kind: "agent",
  icon: "Network",
  description: "Smoke source: publishes units from its json output (agent-node split §2.2)",
  config: SPLITTER_CONFIG,
});
const WORKER_ROW = templateStore.createNodeTemplate({
  key: "smoke_unit_worker",
  name: "Unit worker (smoke)",
  kind: "agent",
  icon: "agent",
  description: "Smoke consumer: runs once per unit, joins the aggregate (§2.4 per-unit)",
  config: WORKER_CONFIG,
});
const ROLLUP_ROW = templateStore.createNodeTemplate({
  key: "smoke_rollup",
  name: "Unit rollup (smoke)",
  kind: "agent",
  icon: "FileText",
  description: "Consumes the consumer's aggregate whole — the parent continuing after the join",
  config: ROLLUP_CONFIG,
});

// The flow template itself — created through the store so template-lint runs
// (a split-config or {{ref}} problem throws at save, exactly as in the app).
//
// The rollup's `units` input is mapped explicitly with JSONata: the worker
// publishes its aggregate `{units: [...]}` at run time, but a markdown agent's
// lint contract is `{markdown}` — the input_map declares the aggregate field
// so `{{input.units}}` lints and the join output flows on.
const TEMPLATE_ID = templateStore.create({
  name: "Split smoke: units fan-out",
  description:
    "Agent-node split end-to-end (no plan/build): a json agent splits its output into units → a per-unit agent runs one child per unit (parallel where no dependency, up to 2) → the engine joins and publishes the aggregate → a rollup agent consumes it whole. "
    + "Watch in the trail: the source's 'splits into 3 unit child flows' lifecycle event, one child flow per unit (kind=split), the dependent unit starting only after its dependency, and the consumer's aggregate output {units:[{key,title,status,output}]}.",
  trigger: { type: "manual", task_type: "jira" },
  nodes: [
    { key: "scope_splitter", nodeTemplateId: SPLITTER_ROW.id, trigger: { type: "auto" } },
    { key: "smoke_unit_worker", nodeTemplateId: WORKER_ROW.id, trigger: { type: "auto" } },
    {
      key: "smoke_rollup",
      nodeTemplateId: ROLLUP_ROW.id,
      trigger: { type: "auto" },
      input_map: { units: "nodes.smoke_unit_worker.output.units" },
    },
  ],
  edges: [
    { from: "scope_splitter", to: "smoke_unit_worker", kind: "next" },
    { from: "smoke_unit_worker", to: "smoke_rollup", kind: "next" },
  ],
});

// ── helpers ──────────────────────────────────────────────────────────────────

function must<T>(row: T | null | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** Poll the DB until the async engine bg work settles (or fail loudly). */
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface SplitChildPayload {
  parentNodeKey: string;
  unit: {
    key: string;
    title: string;
    dependsOn: string[];
    position: number;
    item: Record<string, unknown>;
  };
}

/**
 * The parent flow's split children, ordered by their unit position. The row
 * order itself is unstable: sibling child flows are inserted within the same
 * millisecond (db.now()) and the SQL tiebreak falls to a random id — so the
 * assertions ride the splitter's own deterministic `position`, not row order.
 */
function splitChildren(flowId: string): { id: string; name: string; payload: SplitChildPayload }[] {
  return db.all<{ id: string; name: string; trigger_payload: string | null }>(
    `SELECT id, name, trigger_payload FROM flows WHERE parent_flow_id=? AND kind='split' ORDER BY created_at, id`,
    flowId,
  )
    .map((r) => ({
      id: r.id,
      name: r.name,
      payload: JSON.parse(must(r.trigger_payload, `trigger payload of ${r.id}`)) as SplitChildPayload,
    }))
    .sort((a, b) => a.payload.unit.position - b.payload.unit.position);
}

interface AggregateEntry { key: string; title: string; status: string; output?: Record<string, unknown> }

/** One flow node's status + parsed output. */
function nodeOf(flowId: string, nodeKey: string): { status: string; output: Record<string, unknown> } {
  const row = must(
    db.get<{ status: string; output: string | null }>(
      `SELECT status, output FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey,
    ),
    `node ${nodeKey} of ${flowId}`,
  );
  return {
    status: row.status,
    output: row.output ? (JSON.parse(row.output) as Record<string, unknown>) : {},
  };
}

const joinPublished = (flowId: string) => () => {
  const worker = nodeOf(flowId, "smoke_unit_worker");
  const units = worker.output.units as AggregateEntry[] | undefined;
  return worker.status === "done" && Array.isArray(units) && units.length === 3
    && units.every((u) => u.status === "done");
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("split smoke template — authoring path (templateStore + template-lint)", () => {
  it("saves through the store with the split knobs on the right nodes", () => {
    const tpl = must(templateStore.flowTemplate(TEMPLATE_ID), "the smoke flow template");
    expect(tpl.name).toBe("Split smoke: units fan-out");

    const graph = must(templateStore.graph(TEMPLATE_ID), "the smoke template graph");
    expect(graph.nodes.map((n) => n.key)).toEqual(["scope_splitter", "smoke_unit_worker", "smoke_rollup"]);
    expect(graph.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      "scope_splitter>smoke_unit_worker", "smoke_unit_worker>smoke_rollup",
    ]);

    // the source def carries the split knob (createNodeTemplate parsed it —
    // the schema defaults ride along: key_field/depends_on_field)
    const splitter = must(templateStore.nodeTemplate(SPLITTER_ROW.id), "splitter row");
    const splitterConfig = must(splitter.config, "splitter config");
    expect(splitterConfig.split).toMatchObject({
      field: "units",
      key_field: "key",
      depends_on_field: "dependsOn",
      target: "smoke_unit_worker",
    });
    // the consumer def carries the consume knobs
    const worker = must(templateStore.nodeTemplate(WORKER_ROW.id), "worker row");
    expect(worker.config).toMatchObject({ split_consume: "per-unit", split_parallel_max: 2 });
  });
});

describe("split smoke template — end-to-end run (source → per-unit children → join → parent continues)", () => {
  it("fans units out, schedules the dependency, publishes the aggregate and continues", async () => {
    const taskId = "task_smoke_e2e";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "jira", "SMOKE-1", "split smoke end-to-end run", "open", "task", "P2",
    );
    const flowId = flowEngine.create(taskId, "https://git.example.com/o/r", "split smoke e2e", { templateId: TEMPLATE_ID });

    flowEngine.start(flowId);

    // the splitter answered the contract directive with the unit payload and
    // the consumer expanded one child per unit
    await until(() => splitChildren(flowId).length === 3, "the per-unit expansion");
    const children = splitChildren(flowId);
    expect(children.map((c) => c.payload.unit.key)).toEqual(["foundation", "interface", "rollout"]);
    expect(children.map((c) => c.payload.unit.position)).toEqual([0, 1, 2]);
    for (const c of children) {
      expect(c.payload.parentNodeKey).toBe("smoke_unit_worker"); // the consumer owns every child
      expect(c.name).toContain(c.payload.unit.title); // the child flow names its unit
    }
    expect(must(children.find((c) => c.payload.unit.key === "interface"), "interface child").payload.unit.dependsOn)
      .toEqual(["foundation"]);

    // the child prompts rendered the unit through {{input.unit.*}}
    await until(joinPublished(flowId), "the join");
    const unitPrompts = stubPort.prompts.filter((p) => p.includes("ONE unit of a split flow"));
    expect(unitPrompts).toHaveLength(3);
    expect(unitPrompts.some((p) => p.includes("Unit: Foundation schema") && p.includes("Draft the shared data model"))).toBe(true);
    for (const p of unitPrompts) {
      expect(p).not.toContain("{{"); // nothing left unrendered
    }

    // declared dependency gates scheduling: interface starts only after
    // foundation's run finished (its stub start came first)
    const idxOf = (needle: string) => stubPort.prompts.findIndex((p) => p.includes(needle));
    const foundationIdx = idxOf("Unit: Foundation schema");
    const interfaceIdx = idxOf("Unit: Public interface");
    const rolloutIdx = idxOf("Unit: Rollout notes");
    expect(foundationIdx).toBeGreaterThanOrEqual(0);
    expect(interfaceIdx).toBeGreaterThan(foundationIdx);
    expect(rolloutIdx).toBeGreaterThan(-1);

    // the join published the aggregate on the consumer in unit order
    const worker = nodeOf(flowId, "smoke_unit_worker");
    const units = worker.output.units as AggregateEntry[];
    expect(units.map((u) => `${u.key}:${u.status}`)).toEqual([
      "foundation:done", "interface:done", "rollout:done",
    ]);
    for (const u of units) {
      expect(must(u.output, `output of unit ${u.key}`).markdown)
        .toBe("Smoke stub markdown output"); // the child's own output rode the aggregate
    }

    // the parent continued: the rollup consumed the aggregate whole and ran
    await until(() => nodeOf(flowId, "smoke_rollup").status === "done", "the rollup run");
    const rollupPrompt = must(
      stubPort.prompts.find((p) => p.includes("All units of the split have resolved")),
      "the rollup prompt",
    );
    expect(rollupPrompt).toContain('"foundation"'); // the aggregate rendered in
    expect(rollupPrompt).toContain('"interface"');
    expect(rollupPrompt).toContain('"rollout"');
    expect(rollupPrompt).not.toContain("{{"); // nothing left unrendered
    expect(nodeOf(flowId, "smoke_rollup").output.markdown).toBe("Smoke stub markdown output");

    // exactly one splitter run (json agent), three unit runs, one rollup run
    expect(stubPort.prompts.filter((p) => p.includes("RESPONSE FORMAT"))).toHaveLength(1);
    expect(stubPort.prompts.filter((p) => p.includes("All units of the split"))).toHaveLength(1);
  });
});
