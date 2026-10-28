/**
 * Seed a demo flow that samples the Plan fan-out / step sub-flows UI mid-flight
 * (Phase 4 monitoring surface). Zero-dependency: plain Node + better-sqlite3.
 *
 * Usage:
 *   node scripts/seed-demo-fanout.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-demo-fanout.mjs --reset   # remove the demo flow/task + children
 *   npm run seed:demo:fanout / seed:demo:fanout:reset
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
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSeedDb } from "./lib/seed-db.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TASK_ID = "demo-143";
const FLOW_NAME = "DEMO-143 flow";
const RESET = process.argv.includes("--reset");

const dbFile = resolveSeedDb(root);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));

// the runtime migrations (lib/db/index.ts) add the columns this seed inserts —
// guard them here too so the script works against a freshly created DB
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
const ensureCols = (t, defs) => {
  for (const [n, ddl] of defs) if (!hasCol(t, n)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${n} ${ddl}`);
};
ensureCols("flows", [
  ["execution_mode", "TEXT NOT NULL DEFAULT 'cloud'"],
  ["repo_id", "TEXT"],
  ["trigger_payload", "TEXT"],
  ["worktree_dir", "TEXT"],
]);
ensureCols("runs", [
  ["model", "TEXT"],
  ["input_tokens", "INTEGER"], ["output_tokens", "INTEGER"],
  ["cache_read_tokens", "INTEGER"], ["cache_write_tokens", "INTEGER"],
  ["duration_ms", "INTEGER"], ["cost_cents", "INTEGER"], ["usage", "TEXT"],
  ["branch_id", "TEXT REFERENCES branches(id)"],
]);

const now = () => new Date().toISOString();
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

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

function reset() {
  const flows = db.prepare(`SELECT id FROM flows WHERE name=? OR task_id=?`).all(FLOW_NAME, TASK_ID);
  const childIds = [];
  for (const f of flows) {
    for (const c of db.prepare(`SELECT id FROM flows WHERE parent_flow_id=?`).all(f.id)) childIds.push(c.id);
  }
  // linkage first (plan_steps.sub_flow_id + step_merges reference the children,
  // so the links die before the child rows do — FK-safety without pragmas)
  for (const f of flows) {
    db.prepare(`DELETE FROM step_merges WHERE flow_id=? OR parent_flow_id=?`).run(f.id, f.id);
    db.prepare(`DELETE FROM plan_steps WHERE flow_id=?`).run(f.id);
  }
  for (const fid of [...childIds, ...flows.map((f) => f.id)]) {
    for (const t of ["events", "messages", "runs", "artifacts", "comments", "branches", "nodes"])
      db.prepare(`DELETE FROM ${t} WHERE flow_id=?`).run(fid);
    db.prepare(`DELETE FROM flows WHERE id=?`).run(fid);
  }
  if (flows.length) console.log(`removed demo flow + ${childIds.length} step children`);
  db.prepare(`DELETE FROM tasks WHERE id=?`).run(TASK_ID);
}

if (RESET) {
  reset();
  console.log("fanout demo reset done");
  process.exit(0);
}

reset();

// ── task ────────────────────────────────────────────────────────────────────
const repo = db.prepare(`SELECT id, cloud_url FROM repos ORDER BY created_at LIMIT 1`).get();
db.prepare(`INSERT INTO tasks (id,key,type,summary,description,status,issue_type,priority,repo_url,external_url,raw,fields,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(TASK_ID, "DEMO-143", "jira", "Saved dashboard views for the support team",
    PRD, "In Progress", "Story", "High",
    repo?.cloud_url ?? null, "https://jira.example.com/browse/DEMO-143",
    JSON.stringify({ demo: true }), JSON.stringify({ prd: PRD, figma_urls: [] }), now());
console.log("task DEMO-143 inserted");

// ── parent flow + SDLC node chain (plan approved → build fanning out) ───────
const flowId = "flow_fanoutdemo"; // stable tail drives the integration-branch formula
const ts0 = now();
db.prepare(`INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,current_node,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(flowId, TASK_ID, FLOW_NAME, "active",
    repo?.cloud_url ?? "https://gitlab.example.com/acme/webapp", repo?.id ?? null, "cloud", "build", ts0, ts0);
const nodeIds = {};
for (const key of ["plan", "build", "pipeline", "review", "resolve"]) {
  const nid = uid("node_");
  nodeIds[key] = nid;
  db.prepare(`INSERT INTO nodes (id,flow_id,node_key,type,status,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)`)
    .run(nid, flowId, key, key, ts0, ts0);
}
console.log(`flow created: ${flowId} (integration branch: feature/demo-143-${flowId.slice(-6)})`);

// plan v1: approved, published `execution: steps`; build currently orchestrating
const artId = uid("art_");
db.prepare(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,feedback,created_at)
  VALUES (?,?,?,'plan',?,?,?,?,?,?)`)
  .run(artId, nodeIds.plan, flowId, 1, PLAN,
    JSON.stringify({ execution: "steps", executionSource: "knob", steps: meta.steps, branches: [] }),
    "approved", null, minsAgo(42));
db.prepare(`UPDATE nodes SET status='approved', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ latestArtifact: artId, version: 1, steps: meta.steps, execution: "steps" }), minsAgo(40), nodeIds.plan);
db.prepare(`UPDATE nodes SET status='running', input=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ fanout: { mode: "steps", parallel_max: 2 } }), minsAgo(40), nodeIds.build);

const ev = (flow_id, nodeId, msg, m, type = "lifecycle") =>
  db.prepare(`INSERT INTO events (id,flow_id,node_id,type,message,data,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid("ev_"), flow_id, nodeId, type, msg, null, minsAgo(m));

ev(flowId, nodeIds.plan, "plan v1 ready for review · 6 steps", 44);
ev(flowId, nodeIds.plan, "plan approved — execution published: step-by-step (6 steps)", 40, "lifecycle");
ev(flowId, nodeIds.build, "build fans out into 6 step sub-flows — one child per pending plan step, up to 2 concurrent (file-disjoint)", 38);

// ── the six step children, mixed states ──────────────────────────────────────
const itg = `feature/demo-143-${flowId.slice(-6)}`;
let pos = 0;
const steps = meta.steps;
const childOf = {}; // step id → { childId, branch }

function seedStep(step, opts) {
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
  db.prepare(`INSERT INTO flows (id,task_id,parent_flow_id,kind,name,status,mr_branch,repo_url,repo_id,execution_mode,trigger_payload,current_node,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(childId, TASK_ID, flowId, "step", `${FLOW_NAME} · step: ${step.title}`,
      opts.flowStatus ?? "active", branch,
      repo?.cloud_url ?? "https://gitlab.example.com/acme/webapp", repo?.id ?? null, "cloud",
      JSON.stringify(payload), opts.childNodeKey ?? "step_build", childTs, opts.updatedAt ?? childTs);
  const childNodeId = uid("node_");
  db.prepare(`INSERT INTO nodes (id,flow_id,node_key,type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(childNodeId, childId, "step_build", "step_build", opts.nodeStatus, childTs, opts.updatedAt ?? childTs);
  db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,completed_by,sub_flow_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rowId, flowId, artId, step.id, pos, step.title, step.detail ?? null,
      JSON.stringify(step.files ?? []), null, opts.stepStatus, "agent", opts.completedBy ?? null, childId,
      minsAgo(44), opts.stepUpdatedAt ?? minsAgo(opts.minsAgo ?? 20));
  // billed runs (sample charging — the cost rollup reads these)
  for (const [i, r] of (opts.runs ?? []).entries()) {
    db.prepare(`INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,status,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,duration_ms,cost_cents,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid("run_"), childId, childNodeId, `demo-agent-${step.id}-${i + 1}`, `demo-run-${step.id}-${i + 1}`,
        r.status, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.duration_ms, r.cost_cents,
        r.created_at, r.updated_at);
    ev(childId, childNodeId, `run ${r.status} · ${r.model} · ${r.input_tokens + r.output_tokens} tok`, 38 - i);
  }
  for (const m of opts.events ?? []) ev(flowId, nodeIds.build, m, m.mins ?? 20);
  childOf[step.id] = { childId, branch };
  return { childId, branch, childNodeId };
}

// s1 + s2: merged (build runs + merge-commit bookkeeping, durable merged rows)
for (const step of steps.slice(0, 2)) {
  seedStep(step, {
    stepStatus: "done", completedBy: "merge", stepUpdatedAt: minsAgo(34),
    flowStatus: "done", nodeStatus: "done",
    runs: [RUN(38, 94, 21, 4100), RUN(36, 47, 9, 1800), RUN(34, 12, 4, 900)],
  });
}
for (const step of steps.slice(0, 2)) {
  db.prepare(`INSERT INTO step_merges (id,flow_id,parent_flow_id,parent_node,branch,status,attempts,error,created_at,updated_at)
    VALUES (?,?,?,?,?,'merged',0,NULL,?,?)`)
    .run(uid("smg_"), childOf[step.id].childId, flowId, "build", childOf[step.id].branch, minsAgo(34), minsAgo(34));
}

// s3: building — live run in flight, cost unknown yet
seedStep(steps[2], {
  stepStatus: "pending",
  nodeStatus: "running",
  runs: [{ status: "running", cost_cents: null, duration_ms: null, model: "claude-sonnet-4-5", input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, created_at: minsAgo(3), updated_at: minsAgo(3) }],
  events: [`step "Filter encode/decode" → child flow · branch ${itg}-s3`],
});
ev(flowId, nodeIds.build, `step child resolved ("Saved views table + migration")`, 35);
ev(flowId, nodeIds.build, `step child resolved ("View store CRUD + visibility")`, 34);
ev(flowId, nodeIds.build, `step "Filter encode/decode" started (qualified parallel — files disjoint from in-flight sibling)`, 3);

// s4: awaiting approval — diff is up (stale-base chip derives live: an earlier
// overlapping sibling already merged onto the integration branch)
seedStep(steps[3], {
  stepStatus: "pending",
  nodeStatus: "awaiting_approval",
  runs: [RUN(37, 88, 26, 5200)],
  events: [`step "Views API routes" → child flow · branch ${itg}-s4 (awaiting approval)`],
});
ev(flowId, nodeIds.build, `step "Views API routes" awaiting approval — 4 files changed`, 10);

// s5: conflict → the bounded merge-fix agent is running on the step branch
seedStep(steps[4], {
  stepStatus: "pending",
  nodeStatus: "running",
  runs: [RUN(36, 91, 28, 5600), { ...RUN(14, 71, 11, 2100), status: "finished" }],
  events: [`step "Dashboard ViewBar UI" → child flow · branch ${itg}-s5`, `merge-fix agent starting (attempt 1/2) — resolving the merge conflict on the step branch`],
});
db.prepare(`INSERT INTO step_merges (id,flow_id,parent_flow_id,parent_node,branch,status,attempts,error,created_at,updated_at)
  VALUES (?,?,?,?,?,'conflict',1,?,?,?)`)
  .run(uid("smg_"), childOf[steps[4].id].childId, flowId, "build", childOf[steps[4].id].branch,
    "CONFLICT (content): Merge conflict in app/dashboard/ViewBar.tsx", minsAgo(22), minsAgo(14));
ev(flowId, nodeIds.build, `step "Dashboard ViewBar UI" merge conflict on ${itg} — dispatching the merge-fix agent`, 22);

// s6: pending — child spawned by the expansion, never started (slot budget)
seedStep(steps[5], {
  stepStatus: "pending",
  nodeStatus: "pending",
  events: [`step "Tests: store, filters, routes" → child flow`],
});

const rows = db.prepare(`SELECT meta_id,title,status,completed_by FROM plan_steps WHERE flow_id=? ORDER BY position`).all(flowId);
const totalCents = db.prepare(`SELECT SUM(cost_cents) c FROM runs WHERE flow_id IN (SELECT sub_flow_id FROM plan_steps WHERE flow_id=?)`).get(flowId).c;
console.log("\nfan-out state (parent panel shows exactly this):");
for (const s of rows) {
  const st = s.completed_by === "merge" ? "merged  " : s.completed_by;
  console.log(`  [${s.status === "done" ? "x" : " "}] ${s.meta_id}  ${(st ?? "").padEnd(8)} ${s.title}`);
}
console.log(`\nchildren cost rollup: $${((totalCents ?? 0) / 100).toFixed(2)} (parent header Cost chip + per-card chips)`);
console.log(`\nopen http://localhost:3000/flows/${flowId}`);
console.log("sample data only — the children have no real agent runs behind them;");
console.log(`approve/skip actions will not merge real branches (integration branch would be ${itg}).`);
