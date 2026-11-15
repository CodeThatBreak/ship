/**
 * Seed the agent-node SPLIT smoke template (agent-node split plan §6 Phase 5,
 * first bullet): a declarative, plan-free template demonstrating the full
 * split loop end-to-end —
 *
 *   scope_splitter (json agent, split: units → smoke_unit_worker)
 *     → smoke_unit_worker (agent, split_consume: "per-unit", parallel_max 2)
 *       → smoke_rollup (agent, consumes the consumer's aggregate whole)
 *
 * Start a flow from it in the app (home page → "Split smoke: units fan-out")
 * and watch the trail: the source publishes 3 units → the consumer expands one
 * child flow per unit (kind=split) → the declared dependency gates scheduling
 * (interface waits on foundation; the two independents start together within
 * the 2-slot budget) → the engine joins and publishes the aggregate on the
 * consumer → the parent continues into the rollup agent.
 *
 * NOTE: the units come from a real agent run on the source node (json output
 * + output contract), so running the template needs a configured agent port.
 * The configs here mirror the authoring-path test in
 * lib/engine/templates/split-smoke-template.test.ts (template-lint runs when
 * the app saves this template — the shapes are lint-clean).
 *
 * Usage:
 *   node scripts/seed-split-smoke.mjs           # seed (idempotent: reseeds the template)
 *   node scripts/seed-split-smoke.mjs --reset   # remove the smoke template + demo task
 *   npm run seed:split / seed:split:reset
 *
 * Non-destructive by default: only the smoke template's own rows are touched
 * (non-demo databases refused via scripts/lib/seed-db.mjs — AGENTS.md §1).
 */
import crypto from "crypto";
import { deleteFlowCascadePg, deleteTaskDemoFlows, now, openSeedPrisma } from "./lib/seed-db.mjs";

const TASK_ID = "demo-313";
const TASK_KEY = "DEMO-313";
const TEMPLATE_ID = "tpl_split_smoke";
const SPLITTER_ID = "nt_smoke_splitter";
const WORKER_ID = "nt_smoke_unit_worker";
const ROLLUP_ID = "nt_smoke_rollup";
const RESET = process.argv.includes("--reset");

const { prisma } = openSeedPrisma();

// ── the smoke template definition (mirrors the authoring-path test) ──────────

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

// the declarative node templates (global Library rows, is_builtin=0)
const NODE_TEMPLATES = [
  {
    id: SPLITTER_ID, key: "smoke_scope_splitter", name: "Scope splitter (smoke)", kind: "agent",
    icon: "Network",
    description: "Smoke source: publishes units from its json output (agent-node split §2.2)",
    config: SPLITTER_CONFIG,
  },
  {
    id: WORKER_ID, key: "smoke_unit_worker", name: "Unit worker (smoke)", kind: "agent",
    icon: "agent",
    description: "Smoke consumer: runs once per unit, joins the aggregate (§2.4 per-unit)",
    config: WORKER_CONFIG,
  },
  {
    id: ROLLUP_ID, key: "smoke_rollup", name: "Unit rollup (smoke)", kind: "agent",
    icon: "FileText",
    description: "Consumes the consumer's aggregate whole — the parent continuing after the join",
    config: ROLLUP_CONFIG,
  },
];

// the flow template's node instances: key, nodeTemplateId, trigger, config, inputMap
const TEMPLATE_NODES = [
  ["scope_splitter", SPLITTER_ID, '{"type":"auto"}', "{}", "{}"],
  ["smoke_unit_worker", WORKER_ID, '{"type":"auto"}', "{}", "{}"],
  // the rollup's `units` input is mapped explicitly with JSONata: the worker
  // publishes its aggregate `{units:[...]}` at run time, but a markdown
  // agent's lint contract is `{markdown}` — the input_map declares the
  // aggregate field so {{input.units}} lints and the join output flows on
  ["smoke_rollup", ROLLUP_ID, '{"type":"auto"}', "{}", '{"units":"nodes.smoke_unit_worker.output.units"}'],
];

// the flow template's edges: from, to, kind, label
const TEMPLATE_EDGES = [
  ["scope_splitter", "smoke_unit_worker", "next", null],
  ["smoke_unit_worker", "smoke_rollup", "next", null],
];

const TEMPLATE_DESCRIPTION =
  "Agent-node split end-to-end (no plan/build): a json agent splits its output into units → a per-unit agent "
  + "runs one child flow per unit (parallel where no dependency, up to 2) → the engine joins and publishes the "
  + "aggregate on the consumer → the parent continues into a rollup agent. Watch in the trail: the source's "
  + "'splits into 3 unit child flows' lifecycle event, one child flow per unit (kind=split), the dependent unit "
  + "starting only after its dependency, and the consumer's aggregate output {units:[{key,title,status,output}]}. "
  + "Running it needs a configured agent port (the units come from the source node's real json run).";

// ── helpers ──────────────────────────────────────────────────────────────────

const flowsOnTemplate = async () =>
  prisma.flow.count({ where: { templateId: TEMPLATE_ID } });

/** Remove the smoke template's rows (refused while flows run on the template). */
async function removeTemplateRows() {
  const flowCount = await flowsOnTemplate();
  if (flowCount > 0) {
    console.log(`template ${TEMPLATE_ID} is used by ${flowCount} flow(s) — kept (delete the flows first)`);
    return false;
  }
  // child rows first (the FKs are enforced in Postgres)
  await prisma.flowTemplateEdge.deleteMany({ where: { templateId: TEMPLATE_ID } });
  await prisma.flowTemplateNode.deleteMany({ where: { templateId: TEMPLATE_ID } });
  await prisma.hook.deleteMany({ where: { templateId: TEMPLATE_ID } });
  await prisma.flowTemplate.deleteMany({ where: { id: TEMPLATE_ID } });
  // the node templates are global Library rows — only delete when nothing
  // else still references them (the same rule TemplateStore.delete applies)
  for (const nt of NODE_TEMPLATES) {
    const used = await prisma.flowTemplateNode.count({
      where: { nodeTemplateId: nt.id, templateId: { not: TEMPLATE_ID } },
    });
    if (used === 0) await prisma.nodeTemplate.deleteMany({ where: { id: nt.id } });
  }
  return true;
}

async function seedTask() {
  await prisma.task.upsert({
    where: { id: TASK_ID },
    update: {}, // INSERT OR IGNORE semantics: an existing demo task stays as-is
    create: {
      id: TASK_ID,
      type: "jira",
      key: TASK_KEY,
      summary: "Split smoke demo — units fan-out end-to-end",
      description: "Demo task for the split smoke template: run the 'Split smoke: units fan-out' flow from the template gallery on this task.",
      status: "In Progress",
      issueType: "Story",
      priority: "Medium",
      repoUrl: null,
      externalUrl: `https://jira.example.com/browse/${TASK_KEY}`,
      raw: JSON.stringify({ demo: true }),
      fields: { prd: "See the flow description — the template needs no repo.", figmaUrls: [] },
      syncedAt: now(),
    },
  });
}

async function seedNodeTemplates() {
  const ts = now();
  for (const nt of NODE_TEMPLATES) {
    await prisma.nodeTemplate.upsert({
      where: { id: nt.id },
      update: {}, // INSERT OR IGNORE semantics: an existing row stays as-is
      create: {
        id: nt.id,
        key: nt.key,
        name: nt.name,
        kind: nt.kind,
        version: 1,
        description: nt.description,
        icon: nt.icon,
        config: nt.config,
        isBuiltin: false,
        templateId: null,
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
}

/** Reseed the template's own rows; keeps them when flows still reference them. */
async function seedTemplate() {
  const existing = await prisma.flowTemplate.findUnique({ where: { id: TEMPLATE_ID } });
  if (existing) {
    // can only happen when flows reference the template (removeTemplateRows kept it)
    console.log(`template ${TEMPLATE_ID} kept (flows reference it) — reseed after the flows are removed`);
    return false;
  }
  const ts = now();
  await prisma.flowTemplate.create({
    data: {
      id: TEMPLATE_ID,
      name: "Split smoke: units fan-out",
      description: TEMPLATE_DESCRIPTION,
      version: 1,
      isBuiltin: false,
      trigger: { type: "manual", task_type: "jira" },
      createdAt: ts,
      updatedAt: ts,
    },
  });
  for (const [key, nodeTemplateId, trigger, config, inputMap] of TEMPLATE_NODES) {
    await prisma.flowTemplateNode.create({
      data: {
        id: `ftn_split_smoke_${key}`,
        templateId: TEMPLATE_ID,
        nodeKey: key,
        nodeTemplateId,
        label: null,
        trigger: JSON.parse(trigger),
        joinMode: "all",
        config: JSON.parse(config),
        inputMap: JSON.parse(inputMap),
        x: null,
        y: null,
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
  for (const [from, to, kind, label] of TEMPLATE_EDGES) {
    await prisma.flowTemplateEdge.create({
      data: {
        id: `fte_split_smoke_${from}_${to}`,
        templateId: TEMPLATE_ID,
        fromKey: from,
        toKey: to,
        kind,
        label,
        condition: null,
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
  return true;
}

// ── the script ───────────────────────────────────────────────────────────────

if (RESET) {
  const removed = await removeTemplateRows();
  const flowIds = (await prisma.flow.findMany({ where: { taskId: TASK_ID }, select: { id: true } })).map((r) => r.id);
  if (flowIds.length) {
    for (const id of flowIds) await deleteFlowCascadePg(prisma, id);
    console.log(`removed ${flowIds.length} smoke flow(s) for ${TASK_KEY}`);
  }
  await deleteTaskDemoFlows(prisma, TASK_ID, []);
  console.log(removed ? "split smoke template + demo task reset done" : "split smoke demo task reset (template kept — flows reference it)");
  process.exit(0);
}

// reseed = replace the template's own rows (config tweaks land on the next
// start); flows snapshot at creation, so running flows are never affected
await removeTemplateRows();
await seedNodeTemplates();
await seedTemplate();
await seedTask();

// the flow-trigger hook the store provisions on every save (TemplateStore.
// syncTriggers → HookStore.syncTemplate) — webhook starts stay available
const existingHook = await prisma.hook.findFirst({ where: { templateId: TEMPLATE_ID, flowId: null } });
if (!existingHook) {
  const secret = `whsec_${crypto.randomBytes(32).toString("base64")}`;
  await prisma.hook.create({
    data: {
      id: "hk_split_smoke",
      templateId: TEMPLATE_ID,
      flowId: null,
      nodeKey: null,
      secret,
      filter: null,
      createdAt: now(),
    },
  });
}

const nodeRows = [];
for (const id of [SPLITTER_ID, WORKER_ID, ROLLUP_ID]) {
  const nt = await prisma.nodeTemplate.findUnique({ where: { id }, select: { key: true, name: true } });
  if (nt) nodeRows.push(nt);
}
console.log("split smoke template seeded:");
for (const n of nodeRows) console.log(`  - ${n.key}  (${n.name})`);
console.log(`template: ${TEMPLATE_ID}  · demo task: ${TASK_KEY}`);
console.log("\nnext steps:");
console.log("  1. open http://localhost:3000 and start a flow from the template gallery");
console.log("     ('Split smoke: units fan-out') on task DEMO-313 — needs a configured agent port");
console.log("  2. watch the trail: 3 unit child flows fan out (kind=split), 'interface' waits on");
console.log("     'foundation', the join publishes {units:[…]} and the rollup agent closes the loop");

await prisma.$disconnect();
