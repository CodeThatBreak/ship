/**
 * Seed a demo flow for a CUSTOM template (Phase 5 §10B): instantiates the
 * seeded "Release notes + notify" starter and fast-forwards it so the graph,
 * the decision card, and the skipped branch tell the story on open — all
 * without any agent runs or external calls. Plain Node + @prisma/client
 * writes against the demo Postgres database — no TS compile step needed.
 *
 * Usage:
 *   node scripts/seed-custom-flow.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-custom-flow.mjs --reset   # remove the demo flows + task only
 *
 * Target database: DATABASE_URL, defaulting to the demo DB (devflow). The seed
 * guard refuses any other database (AGENTS.md §1) — see scripts/lib/seed-db.mjs.
 *
 * What you get (open http://localhost:3000 → the custom demo flows on DEMO-201):
 *   - flow #1: release_notes done (markdown artifact) → ship_decision chose
 *     "send" (decision card shows the pick) → notify done → the taken edge
 *     highlights in the graph
 *   - flow #2: same template, ship_decision chose "drop" → notify ends at
 *     skipped (branch deactivated, skipped propagation visible)
 *
 * Requires the starter templates to exist — open the app once first (they seed
 * at migration time), or `node scripts/seed-demo-flow.mjs` for the built-in loop demo.
 */
import {
  deleteFlowCascadePg,
  minsAgo,
  now,
  openSeedPrisma,
  uid,
} from "./lib/seed-db.mjs";

const TEMPLATE_ID = "tpl_release_notify";
const FLOW_NAME_DONE = "DEMO custom: release notes shipped";
const FLOW_NAME_SKIP = "DEMO custom: notes dropped";
const TASK_ID = "demo-201";
const RESET = process.argv.includes("--reset");

const { prisma } = openSeedPrisma();

const NOTES = `# Release notes — DEMO-201 webhook delivery retries

## Highlights
- Outbound webhook deliveries are now retried with exponential backoff and jitter
  (1min → 5min → 30min → 2h → 6h, 5 attempts, then dead-letter).
- Every event persists to a durable outbox first, so a worker crash loses nothing.
- New admin endpoint \`POST /admin/webhooks/:id/replay\` revives dead events.

## Upgrading
No config changes required; delivery status is visible per event in the admin table.`;

const template = await prisma.flowTemplate.findUnique({ where: { id: TEMPLATE_ID } });
if (!template) {
  console.error(`starter template "${TEMPLATE_ID}" not found — open the app once (npm run dev) so migrations seed the starters`);
  process.exit(1);
}

async function reset() {
  const ids = new Set();
  for (const row of [
    await prisma.flow.findFirst({ where: { name: FLOW_NAME_DONE }, select: { id: true } }),
    await prisma.flow.findFirst({ where: { name: FLOW_NAME_SKIP }, select: { id: true } }),
    ...(await prisma.flow.findMany({ where: { taskId: TASK_ID }, select: { id: true } })),
  ]) {
    if (row?.id) ids.add(row.id);
  }
  for (const id of ids) {
    await deleteFlowCascadePg(prisma, id);
    console.log(`removed demo flow ${id}`);
  }
  await prisma.task.deleteMany({ where: { id: TASK_ID } });
}

if (RESET) {
  await reset();
  console.log("custom demo reset done");
  process.exit(0);
}

await reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = await prisma.repo.findFirst({ orderBy: { createdAt: "asc" } });
await prisma.task.create({
  data: {
    id: TASK_ID,
    type: "jira",
    key: "DEMO-201",
    summary: "Custom-flow demo — webhook retry release notes",
    description: "Demo task for the custom-flow seed: release notes drafted, decided, notified.",
    status: "Done",
    issueType: "Story",
    priority: "Medium",
    repoUrl: repo?.cloudUrl ?? null,
    externalUrl: "https://jira.example.com/browse/DEMO-201",
    raw: JSON.stringify({ demo: true }),
    fields: { prd: "See the release notes artifacts on the demo flows.", figmaUrls: [] },
    syncedAt: now(),
  },
});
console.log("task DEMO-201 inserted");

// ── flow factory (mirrors FlowEngine.create()'s node snapshot; flows.status
//    'done' — the demo flow is complete, so nothing blocks template edits) ────
async function makeFlow(name, min) {
  const flowId = uid("flow_");
  const ts = minsAgo(min);
  await prisma.flow.create({
    data: {
      id: flowId,
      taskId: TASK_ID,
      name,
      status: "done",
      repoUrl: repo?.cloudUrl ?? "https://gitlab.example.com/acme/webapp",
      repoId: repo?.id ?? null,
      executionMode: "cloud",
      templateId: TEMPLATE_ID,
      triggerPayload: {},
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const nodeIds = {};
  // type mirrors FlowEngine.create(): the node_templates row id backing the
  // instance (declarative kinds resolve the runtime def by that id)
  const typeOf = {
    release_notes: "nt_st_release_notes",
    ship_decision: "nt_st_ship_decision",
    notify: "nt_st_notify",
  };
  for (const key of ["release_notes", "ship_decision", "notify"]) {
    const nid = uid("node_");
    nodeIds[key] = nid;
    const type = (await prisma.nodeTemplate.findUnique({ where: { id: typeOf[key] } }))?.id ?? key;
    await prisma.node.create({
      data: {
        id: nid,
        flowId,
        nodeKey: key,
        type,
        label: null,
        config: {},
        joinMode: "all",
        status: "pending",
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
  return { flowId, nodeIds };
}

const ev = (flowId, msg, m, nodeId = null) =>
  prisma.event.create({
    data: {
      id: uid("ev_"),
      flowId,
      nodeId,
      type: "lifecycle",
      message: msg,
      createdAt: minsAgo(m),
    },
  });

// ── act 1: notes shipped — every node done, the notify branch taken ──────────
const { flowId: f1, nodeIds: n1 } = await makeFlow(FLOW_NAME_DONE, 58);

const art1 = uid("art_");
await prisma.artifact.create({
  data: {
    id: art1,
    nodeId: n1.release_notes,
    flowId: f1,
    kind: "markdown",
    version: 1,
    content: NOTES,
    meta: null,
    status: "draft",
    feedback: null,
    createdAt: minsAgo(48),
  },
});
await prisma.node.update({
  where: { id: n1.release_notes },
  data: { status: "done", output: { markdown: NOTES }, updatedAt: minsAgo(47) },
});
await ev(f1, "release notes drafted (agent node, markdown artifact)", 48, n1.release_notes);

await prisma.node.update({
  where: { id: n1.ship_decision },
  data: {
    status: "done",
    output: { chosen: ["send"], rationale: "manual pick: good enough to notify" },
    updatedAt: minsAgo(40),
  },
});
await ev(f1, "decision 'ship_decision': send — notify branch taken", 40, n1.ship_decision);

await prisma.node.update({
  where: { id: n1.notify },
  data: { status: "done", output: { status: 200, ok: true }, updatedAt: minsAgo(38) },
});
await ev(f1, "notify delivered (http node) — 200", 38, n1.notify);
await ev(f1, "flow complete", 38);

console.log(`flow #1 created: ${f1} → decision chose send`);

// ── act 2: notes dropped — the notify branch resolves inactive → skipped ─────
const { flowId: f2, nodeIds: n2 } = await makeFlow(FLOW_NAME_SKIP, 30);

const art2 = uid("art_");
await prisma.artifact.create({
  data: {
    id: art2,
    nodeId: n2.release_notes,
    flowId: f2,
    kind: "markdown",
    version: 1,
    content: NOTES,
    meta: null,
    status: "draft",
    feedback: null,
    createdAt: minsAgo(24),
  },
});
await prisma.node.update({
  where: { id: n2.release_notes },
  data: { status: "done", output: { markdown: NOTES }, updatedAt: minsAgo(23) },
});
await ev(f2, "release notes drafted (agent node, markdown artifact)", 24, n2.release_notes);

await prisma.node.update({
  where: { id: n2.ship_decision },
  data: {
    status: "done",
    output: { chosen: ["drop"], rationale: "manual pick: not ready to send" },
    updatedAt: minsAgo(18),
  },
});
await prisma.node.update({
  where: { id: n2.notify },
  data: { status: "skipped", updatedAt: minsAgo(18) },
});
await ev(f2, "decision 'ship_decision': drop — notify skipped", 18, n2.ship_decision);
await ev(f2, "flow complete", 18);

console.log(`flow #2 created: ${f2} → decision chose drop, notify skipped`);

console.log(`\nopen http://localhost:3000/flows/${f1} and /flows/${f2}`);

await prisma.$disconnect();
