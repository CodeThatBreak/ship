/**
 * Seed a demo flow that samples the Plan fan-out / step sub-flows UI mid-flight
 * (Phase 4 monitoring surface). Plain Node + @prisma/client writes against the
 * demo Postgres database — no TS compile step needed.
 *
 * Usage:
 *   node scripts/seed-demo-fanout.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-demo-fanout.mjs --reset   # remove the demo flow/task + children
 *
 * Target database: DATABASE_URL, defaulting to the demo DB (devflow). The seed
 * guard refuses any other database (AGENTS.md §1) — see scripts/lib/seed-db.mjs.
 *
 * What you get (open http://localhost:3000 → "DEMO-143 flow"):
 *   - a demo task whose approved plan published `execution: steps` in plan-meta
 *   - the build node mid fan-out: one REAL child flow row per plan step
 *     (kind='step', parent_flow_id set, checklist linked via sub_flow_id) at
 *     MIXED states — you never need agent runs to sample the panel:
 *       s1, s2: merged (done children, billed runs, merge commits simulated)
 *       s3:     building (live run in flight, cost still unknown)
 *       s4:     awaiting approval (finished diff run) — stale-base chip derives live
 *       s5:     conflict → merge-fix agent running (durable step_merges row)
 *       s6:     pending (child spawned, never started)
 *   - per-step cost + duration from the children's run rows (parent cards,
 *     rollup line, graph subtitle `steps 3/6 · building · $…`, home-list line)
 *
 * NOTE: this is sample data, not a live build — the children have no real
 * agent runs, branches or diffs behind them. Try the real feature (fanout.mode
 * = steps on a build node) for an end-to-end run.
 */
import {
  deleteFlowCascadePg,
  minsAgo,
  now,
  openSeedPrisma,
  uid,
} from "./lib/seed-db.mjs";

const TASK_ID = "demo-143";
const FLOW_NAME = "DEMO-143 flow";
const RESET = process.argv.includes("--reset");

const { prisma } = openSeedPrisma();

// ── the demo task: a saved-views feature with a 6-step plan ─────────────────
const PRD = `# PRD: Saved dashboard views for the support team

## Problem
Support engineers rebuild the same ticket filters every time they open the
dashboard —市场主体 filter sets (my-queue, escalations, SLA breaches) exist only
in muscle memory.

## Requirements
1. Users can save the current filter set (search, status, assignee, priority)
   as a named view.
2. Views are per-user by default with "share with team" visibility.
3. Opening a view applies every filter and the saved column layout.
4. A default view can be pinned; it loads on dashboard open.

## Acceptance criteria
- Creating, applying, sharing and pinning a view round-trips through the API.
- URL query params reflect the applied view so refresh keeps it.`;

const PLAN = `# Saved dashboard views — implementation plan

## Approach
Backdrop the saved views as first-class rows with an ownership model, wire the
dashboard filter bar to read/write them, and layer sharing + pinning on top
with dedup protection for view-level params.

## Files to create/change
- \`db/migrations/031_saved_views.sql\` — views table
- \`lib/views/store.ts\` — CRUD + visibility transitions
- \`lib/views/filters.ts\` — filter-set encode/decode (URL ⇄ row)
- \`app/api/views/route.ts\` — list/create
- \`app/api/views/[id]/route.ts\` — update/share/pin/delete
- \`app/dashboard/ViewBar.tsx\` — view picker + save control
- tests for store + filters

\`\`\`json plan-meta
{"execution":"steps","executionSource":"knob","steps":[
 {"id":"s1","title":"Saved views table + migration","detail":"Migration 031: id, owner_id, name, filters JSON, shared, pinned, created/updated.","files":["db/migrations/031_saved_views.sql"]},
 {"id":"s2","title":"View store CRUD + visibility","detail":"create/list/update/delete, share toggle, pin single-default invariant enforced in lib/views/store.ts.","files":["lib/views/store.ts"]},
 {"id":"s3","title":"Filter encode/decode","detail":"lib/views/filters.ts: canonical ⇄ URL query string ⇄ row payload round-trips; unknown params degrade gracefully.","files":["lib/views/filters.ts"]},
 {"id":"s4","title":"Views API routes","detail":"app/api/views + [id]: validation, ownership checks, sharing ACL, 404 vs 403 semantics.","files":["app/api/views/route.ts","app/api/views/[id]/route.ts"]},
 {"id":"s5","title":"Dashboard ViewBar UI","detail":"app/dashboard/ViewBar.tsx: picker, apply, save (name dialog), pin control; wired to the filter bar state.","files":["app/dashboard/ViewBar.tsx"]},
 {"id":"s6","title":"Tests: store, filters, routes","detail":"Unit coverage for CRUD + encode/decode round-trips, route ACL tests.","files":["__tests__/views/"]}
],"branches":[]}
\`\`\``;

const meta = (() => {
  try { return JSON.parse(PLAN.match(/```json plan-meta\s*\n([\s\S]*?)```/)[1]); }
  catch (e) { console.error("plan-meta parse failed", e); process.exit(1); }
})();

// ── step runs: cost/duration pairs per state (sample charging) ──────────────
const RUN = (mStart, durSec, cents, outTok) => ({
  status: "finished", cost_cents: cents, duration_ms: durSec * 1000,
  model: "claude-sonnet-4-5",
  input_tokens: 118_000, output_tokens: outTok ?? 3_800,
  cache_read_tokens: 96_000, cache_write_tokens: 4_200,
  created_at: minsAgo(mStart), updated_at: minsAgo(mStart - durSec / 60),
});

async function reset() {
  const flows = await prisma.flow.findMany({
    where: { OR: [{ name: FLOW_NAME }, { taskId: TASK_ID }] },
    select: { id: true },
  });
  let childCount = 0;
  for (const f of flows) {
    childCount += await prisma.flow.count({ where: { parentFlowId: f.id } });
    await deleteFlowCascadePg(prisma, f.id);
  }
  if (flows.length) console.log(`removed demo flow + ${childCount} step children`);
  await prisma.task.deleteMany({ where: { id: TASK_ID } });
}

if (RESET) {
  await reset();
  console.log("fanout demo reset done");
  process.exit(0);
}

await reset();

// ── task ────────────────────────────────────────────────────────────────────
const repo = await prisma.repo.findFirst({ orderBy: { createdAt: "asc" } });
await prisma.task.create({
  data: {
    id: TASK_ID,
    type: "jira",
    key: "DEMO-143",
    summary: "Saved dashboard views for the support team",
    description: PRD,
    status: "In Progress",
    issueType: "Story",
    priority: "High",
    repoUrl: repo?.cloudUrl ?? null,
    externalUrl: "https://jira.example.com/browse/DEMO-143",
    raw: JSON.stringify({ demo: true }),
    fields: { prd: PRD, figmaUrls: [] },
    syncedAt: now(),
  },
});
console.log("task DEMO-143 inserted");

// ── parent flow + SDLC node chain (plan approved → build fanning out) ───────
const flowId = "flow_fanoutdemo"; // stable tail drives the integration-branch formula
const ts0 = now();
await prisma.flow.create({
  data: {
    id: flowId,
    taskId: TASK_ID,
    name: FLOW_NAME,
    status: "active",
    repoUrl: repo?.cloudUrl ?? "https://gitlab.example.com/acme/webapp",
    repoId: repo?.id ?? null,
    executionMode: "cloud",
    createdAt: ts0,
    updatedAt: ts0,
  },
});
const nodeIds = {};
for (const key of ["plan", "build", "pipeline", "review", "resolve"]) {
  const nid = uid("node_");
  nodeIds[key] = nid;
  await prisma.node.create({
    data: {
      id: nid,
      flowId,
      nodeKey: key,
      type: key,
      status: "pending",
      createdAt: ts0,
      updatedAt: ts0,
    },
  });
}
console.log(`flow created: ${flowId} (integration branch: feature/demo-143-${flowId.slice(-6)})`);

// plan v1: approved, published `execution: steps`; build currently orchestrating
const artId = uid("art_");
await prisma.artifact.create({
  data: {
    id: artId,
    nodeId: nodeIds.plan,
    flowId,
    kind: "plan",
    version: 1,
    content: PLAN,
    meta: { execution: "steps", executionSource: "knob", steps: meta.steps, branches: [] },
    status: "approved",
    feedback: null,
    createdAt: minsAgo(42),
  },
});
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: {
    status: "approved",
    output: { latestArtifact: artId, version: 1, steps: meta.steps, execution: "steps" },
    updatedAt: minsAgo(40),
  },
});
await prisma.node.update({
  where: { id: nodeIds.build },
  data: {
    status: "running",
    input: { fanout: { mode: "steps", parallel_max: 2 } },
    updatedAt: minsAgo(40),
  },
});

const ev = (flow_id, nodeId, msg, m, type = "lifecycle") =>
  prisma.event.create({
    data: {
      id: uid("ev_"),
      flowId: flow_id,
      nodeId,
      type,
      message: msg,
      data: null,
      createdAt: minsAgo(m),
    },
  });

await ev(flowId, nodeIds.plan, "plan v1 ready for review · 6 steps", 44);
await ev(flowId, nodeIds.plan, "plan approved — execution published: step-by-step (6 steps)", 40, "lifecycle");
await ev(flowId, nodeIds.build, "build fans out into 6 step sub-flows — one child per pending plan step, up to 2 concurrent (file-disjoint)", 38);

// ── the six step children, mixed states ──────────────────────────────────────
const itg = `feature/demo-143-${flowId.slice(-6)}`;
let pos = 0;
const steps = meta.steps;
const childOf = {}; // step id → { childId, branch }

async function seedStep(step, opts) {
  const rowId = uid("step_");
  const childId = `flow_fanstep${++pos}${Math.random().toString(36).slice(2, 6)}`;
  const branch = `${itg}-s${pos}`;
  const childTs = minsAgo(38 - (pos - 1) * 1);
  const payload = {
    plan: { title: "DEMO-143: Saved dashboard views for the support team", summary: "Saved dashboard views for the support team" },
    step: { id: step.id, title: step.title, detail: step.detail, files: step.files, branch },
    siblings: steps.filter((s) => s.id !== step.id).map((s) => ({
      id: s.id, title: s.title, files: s.files, status: "pending",
    })),
    parentNodeKey: "build",
  };
  await prisma.flow.create({
    data: {
      id: childId,
      taskId: TASK_ID,
      parentFlowId: flowId,
      kind: "step",
      name: `${FLOW_NAME} · step: ${step.title}`,
      status: opts.flowStatus ?? "active",
      mrBranch: branch,
      repoUrl: repo?.cloudUrl ?? "https://gitlab.example.com/acme/webapp",
      repoId: repo?.id ?? null,
      executionMode: "cloud",
      triggerPayload: payload,
      createdAt: childTs,
      updatedAt: opts.updatedAt ?? childTs,
    },
  });
  const childNodeId = uid("node_");
  await prisma.node.create({
    data: {
      id: childNodeId,
      flowId: childId,
      nodeKey: "step_build",
      type: "step_build",
      status: opts.nodeStatus,
      createdAt: childTs,
      updatedAt: opts.updatedAt ?? childTs,
    },
  });
  await prisma.planStep.create({
    data: {
      id: rowId,
      flowId,
      artifactId: artId,
      metaId: step.id,
      position: pos,
      title: step.title,
      detail: step.detail ?? null,
      files: step.files ?? [],
      branch: null,
      status: opts.stepStatus,
      origin: "agent",
      completedBy: opts.completedBy ?? null,
      subFlowId: childId,
      createdAt: minsAgo(44),
      updatedAt: opts.stepUpdatedAt ?? minsAgo(opts.minsAgo ?? 20),
    },
  });
  // billed runs (sample charging — the cost rollup reads these)
  for (const [i, r] of (opts.runs ?? []).entries()) {
    await prisma.run.create({
      data: {
        id: uid("run_"),
        flowId: childId,
        nodeId: childNodeId,
        agentRef: `demo-agent-${step.id}-${i + 1}`,
        runRef: `demo-run-${step.id}-${i + 1}`,
        status: r.status,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        durationMs: r.duration_ms,
        costCents: r.cost_cents,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
    await ev(childId, childNodeId, `run ${r.status} · ${r.model} · ${r.input_tokens + r.output_tokens} tok`, 38 - i);
  }
  for (const m of opts.events ?? []) await ev(flowId, nodeIds.build, m, m.mins ?? 20);
  childOf[step.id] = { childId, branch };
  return { childId, branch, childNodeId };
}

// s1 + s2: merged (build runs + merge-commit bookkeeping, durable merged rows)
for (const step of steps.slice(0, 2)) {
  await seedStep(step, {
    stepStatus: "done", completedBy: "merge", stepUpdatedAt: minsAgo(34),
    flowStatus: "done", nodeStatus: "done",
    runs: [RUN(38, 94, 21, 4100), RUN(36, 47, 9, 1800), RUN(34, 12, 4, 900)],
  });
}
for (const step of steps.slice(0, 2)) {
  await prisma.stepMerge.create({
    data: {
      id: uid("smg_"),
      flowId: childOf[step.id].childId,
      parentFlowId: flowId,
      parentNode: "build",
      branch: childOf[step.id].branch,
      status: "merged",
      attempts: 0,
      error: null,
      createdAt: minsAgo(34),
      updatedAt: minsAgo(34),
    },
  });
}

// s3: building — live run in flight, cost unknown yet
await seedStep(steps[2], {
  stepStatus: "pending",
  nodeStatus: "running",
  runs: [{ status: "running", cost_cents: null, duration_ms: null, model: "claude-sonnet-4-5", input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, created_at: minsAgo(3), updated_at: minsAgo(3) }],
  events: [`step "Filter encode/decode" → child flow · branch ${itg}-s3`],
});
await ev(flowId, nodeIds.build, `step child resolved ("Saved views table + migration")`, 35);
await ev(flowId, nodeIds.build, `step child resolved ("View store CRUD + visibility")`, 34);
await ev(flowId, nodeIds.build, `step "Filter encode/decode" started (qualified parallel — files disjoint from in-flight sibling)`, 3);

// s4: awaiting approval — diff is up (stale-base chip derives live: an earlier
// overlapping sibling already merged onto the integration branch)
await seedStep(steps[3], {
  stepStatus: "pending",
  nodeStatus: "awaiting_approval",
  runs: [RUN(37, 88, 26, 5200)],
  events: [`step "Views API routes" → child flow · branch ${itg}-s4 (awaiting approval)`],
});
await ev(flowId, nodeIds.build, `step "Views API routes" awaiting approval — 4 files changed`, 10);

// s5: conflict → the bounded merge-fix agent is running on the step branch
await seedStep(steps[4], {
  stepStatus: "pending",
  nodeStatus: "running",
  runs: [RUN(36, 91, 28, 5600), { ...RUN(14, 71, 11, 2100), status: "finished" }],
  events: [`step "Dashboard ViewBar UI" → child flow · branch ${itg}-s5`, `merge-fix agent starting (attempt 1/2) — resolving the merge conflict on the step branch`],
});
await prisma.stepMerge.create({
  data: {
    id: uid("smg_"),
    flowId: childOf[steps[4].id].childId,
    parentFlowId: flowId,
    parentNode: "build",
    branch: childOf[steps[4].id].branch,
    status: "conflict",
    attempts: 1,
    error: "CONFLICT (content): Merge conflict in app/dashboard/ViewBar.tsx",
    createdAt: minsAgo(22),
    updatedAt: minsAgo(14),
  },
});
await ev(flowId, nodeIds.build, `step "Dashboard ViewBar UI" merge conflict on ${itg} — dispatching the merge-fix agent`, 22);

// s6: pending — child spawned by the expansion, never started (slot budget)
await seedStep(steps[5], {
  stepStatus: "pending",
  nodeStatus: "pending",
  events: [`step "Tests: store, filters, routes" → child flow`],
});

const rows = await prisma.planStep.findMany({
  where: { flowId },
  orderBy: { position: "asc" },
  select: { metaId: true, title: true, status: true, completedBy: true },
});
const subFlowIds = (await prisma.planStep.findMany({ where: { flowId }, select: { subFlowId: true } }))
  .map((r) => r.subFlowId)
  .filter(Boolean);
const totalCents = (
  await prisma.run.aggregate({ _sum: { costCents: true }, where: { flowId: { in: subFlowIds } } })
)._sum.costCents;
console.log("\nfan-out state (parent panel shows exactly this):");
for (const s of rows) {
  const st = s.completedBy === "merge" ? "merged  " : s.completedBy;
  console.log(`  [${s.status === "done" ? "x" : " "}] ${s.metaId}  ${(st ?? "").padEnd(8)} ${s.title}`);
}
console.log(`\nchildren cost rollup: $${((totalCents ?? 0) / 100).toFixed(2)} (parent header Cost chip + per-card chips)`);
console.log(`\nopen http://localhost:3000/flows/${flowId}`);
console.log("sample data only — the children have no real agent runs behind them;");
console.log(`approve/skip actions will not merge real branches (integration branch would be ${itg}).`);

await prisma.$disconnect();
