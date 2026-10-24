/**
 * Seed a demo flow that showcases the structured plan / editable checklist feature.
 * Zero-dependency: plain Node + better-sqlite3, no TS compile step needed.
 *
 * Usage:
 *   node scripts/seed-demo-flow.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-demo-flow.mjs --reset   # remove the demo flow + task only
 *
 * What you get (open http://localhost:3000 → "DEMO-142 flow"):
 *   - a demo Jira task with a realistic PRD
 *   - a flow with a 2-version plan history (v2 = refined), awaiting approval
 *   - the editable checklist mid-flight: steps done by hand, by build, pending,
 *     one manual step, one superseded-by-refine (gone)
 *   - a lifecycle event trail so the Activity tab tells the story
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TASK_ID = "demo-142";
const FLOW_NAME = "DEMO-142 flow";
const RESET = process.argv.includes("--reset");

const dbFile = path.resolve(root, process.env.DATABASE_PATH ?? "./data/devflow.db");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));

const now = () => new Date().toISOString();
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ── demo task: a webhook-retry PRD with enough surface for a real plan ────
const PRD = `# PRD: Webhook delivery retries with exponential backoff

## Problem
Outbound webhooks (task.updated, mr.opened) are fire-and-forget. When a
subscriber endpoint is down or slow, the event is lost and downstream systems
drift out of sync. Support handles ~15 "missing event" tasks a week.

## Requirements
1. Persist every outbound webhook event before delivery (durable outbox).
2. Retry failed deliveries with exponential backoff + jitter:
   1min → 5min → 30min → 2h → 6h (max 5 attempts), then mark the event dead.
3. Expose delivery status per event: pending | delivered | retrying | dead.
4. An internal admin endpoint to inspect and manually replay dead events.
5. Delivery worker must not block the request path — process asynchronously.

## Non-goals
- No subscriber-side deduplication contract (out of scope).
- No UI for the admin view in this iteration (API only).

## Acceptance criteria
- Killing the delivery worker mid-retry loses no events.
- A subscriber that fails 4 times then succeeds receives the event exactly once
  on the 5th attempt.
- Dead events are replayable via POST /admin/webhooks/:id/replay.
- Unit tests cover backoff schedule calculation and the outbox state machine.`;

// ── plan v1: first draft (7 steps, multi-branch, before refine) ─────────────
const PLAN_V1 = `# Webhook retry pipeline — implementation plan (v1)

## Approach
Add a durable outbox table, a retry scheduler, and an admin replay endpoint.
Split into two branches so backend and worker can merge independently.

## Files to create/change
- \`db/migrations/014_webhook_events.sql\` — outbox table
- \`lib/webhooks/outbox.ts\` — persist + status transitions
- \`lib/webhooks/backoff.ts\` — retry schedule
- \`lib/webhooks/deliver.ts\` — HTTP delivery + result recording
- \`workers/webhook-retry.ts\` — background worker loop
- \`app/api/webhooks/route.ts\` — publish path writes to outbox first
- \`app/api/admin/webhooks/[id]/replay/route.ts\` — replay endpoint

## Risks / edge cases
- Double delivery if the worker crashes between HTTP success and status write —
  record the attempt *before* delivering.
- Backoff drift under worker restarts — store next_attempt_at, never compute in memory.
- Old events piling up — index on (status, next_attempt_at).

## Testing
- Unit: backoff schedule (exact + jitter bounds), outbox state machine transitions.
- Integration: kill worker mid-retry, restart, assert no loss; subscriber fails
  4× then succeeds → exactly-once on attempt 5.

\`\`\`json plan-meta
{"steps":[
 {"id":"s1","title":"Create webhook_events outbox table","detail":"Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.","files":["db/migrations/014_webhook_events.sql"],"branch":"backend"},
 {"id":"s2","title":"Outbox writer + state machine","detail":"persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.","files":["lib/webhooks/outbox.ts"],"branch":"backend"},
 {"id":"s3","title":"Exponential backoff schedule","detail":"1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.","files":["lib/webhooks/backoff.ts"],"branch":"backend"},
 {"id":"s4","title":"Delivery executor","detail":"POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.","files":["lib/webhooks/deliver.ts"],"branch":"backend"},
 {"id":"s5","title":"Retry worker loop","detail":"Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.","files":["workers/webhook-retry.ts"],"branch":"worker"},
 {"id":"s6","title":"Publish path via outbox","detail":"app/api/webhooks/route.ts writes to the outbox instead of firing directly.","files":["app/api/webhooks/route.ts"],"branch":"backend"},
 {"id":"s7","title":"Admin replay endpoint","detail":"POST /admin/webhooks/:id/replay resets a dead event to pending.","files":["app/api/admin/webhooks/[id]/replay/route.ts"],"branch":"worker"}
],"branches":[
 {"name":"backend","title":"Outbox, backoff & delivery core","scope":"Schema, outbox writer, backoff, delivery executor, publish-path rewiring","files":["db/migrations/014_webhook_events.sql","lib/webhooks/outbox.ts","lib/webhooks/backoff.ts","lib/webhooks/deliver.ts","app/api/webhooks/route.ts"],"steps":["s1","s2","s3","s4","s6"],"dependsOn":[]},
 {"name":"worker","title":"Retry worker + admin replay","scope":"Background retry loop and the admin replay endpoint","files":["workers/webhook-retry.ts","app/api/admin/webhooks/[id]/replay/route.ts"],"steps":["s5","s7"],"dependsOn":["backend"]}
]}
\`\`\``;

// ── plan v2: refined (single branch, s6 reworded→s9, s8 tests added) ─────────
const PLAN_V2 = `# Webhook retry pipeline — implementation plan (v2)

> Refined from feedback: *"Single branch — the pieces are too coupled to split.
> And the acceptance criteria require tests, add a step for them."*

## Approach
Same design as v1, delivered as one cohesive branch: durable outbox → backoff →
delivery → worker → admin replay, with the test suite as a first-class step.

## Files to create/change
- \`db/migrations/014_webhook_events.sql\` — outbox table
- \`lib/webhooks/outbox.ts\` — persist + status transitions
- \`lib/webhooks/backoff.ts\` — retry schedule (pure)
- \`lib/webhooks/deliver.ts\` — HTTP delivery + result recording
- \`workers/webhook-retry.ts\` — background worker loop
- \`app/api/webhooks/route.ts\` — publish via outbox
- \`app/api/admin/webhooks/[id]/replay/route.ts\` — replay endpoint
- \`lib/webhooks/__tests__/\` — backoff + state machine + crash-recovery tests

## Risks / edge cases
- Double delivery on crash between HTTP success and status write — record the
  attempt *before* delivering (unchanged from v1).
- Backoff drift across restarts — next_attempt_at persisted, never recomputed.
- Replay of a live (non-dead) event — replay endpoint rejects non-dead statuses.

## Testing
- Unit: backoff schedule (exact sequence + jitter bounds), every outbox transition
  including illegal ones.
- Integration: worker killed mid-retry → restart → no loss; subscriber fails 4×
  then succeeds → exactly-once delivery on attempt 5; replay of a dead event.

\`\`\`json plan-meta
{"steps":[
 {"id":"s1","title":"Create webhook_events outbox table","detail":"Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.","files":["db/migrations/014_webhook_events.sql"],"branch":null},
 {"id":"s2","title":"Outbox writer + state machine","detail":"persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.","files":["lib/webhooks/outbox.ts"],"branch":null},
 {"id":"s3","title":"Exponential backoff schedule","detail":"1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.","files":["lib/webhooks/backoff.ts"],"branch":null},
 {"id":"s4","title":"Delivery executor","detail":"POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.","files":["lib/webhooks/deliver.ts"],"branch":null},
 {"id":"s5","title":"Retry worker loop","detail":"Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.","files":["workers/webhook-retry.ts"],"branch":null},
 {"id":"s9","title":"Rewire publish path through the outbox","detail":"app/api/webhooks/route.ts persists to the outbox and returns 202; the worker does delivery.","files":["app/api/webhooks/route.ts"],"branch":null},
 {"id":"s7","title":"Admin replay endpoint","detail":"POST /admin/webhooks/:id/replay resets a dead event to pending; rejects non-dead.","files":["app/api/admin/webhooks/[id]/replay/route.ts"],"branch":null},
 {"id":"s8","title":"Test suite: backoff, state machine, crash recovery","detail":"Unit + integration coverage for every acceptance criterion, incl. kill-worker-mid-retry.","files":["lib/webhooks/__tests__/"],"branch":null}
],"branches":[]}
\`\`\``;

// ── engine replicas (syncStepsFromPlan / markStepsDone from lib/engine/steps) ─
function syncStepsFromPlan(flowId, artifactId, steps) {
  const existingAgent = db.prepare(`SELECT * FROM plan_steps WHERE flow_id=? AND origin='agent'`).all(flowId);
  const byMetaId = new Map(existingAgent.filter((s) => s.meta_id).map((s) => [s.meta_id, s]));
  const seen = new Set();
  const ts = now();
  let maxPos = db.prepare(`SELECT MAX(position) p FROM plan_steps WHERE flow_id=?`).get(flowId).p ?? -1;
  for (const step of steps) {
    const metaId = step.id ?? null;
    const prev = metaId ? byMetaId.get(metaId) : undefined;
    if (prev) {
      seen.add(prev.id);
      if (prev.status !== "done") {
        db.prepare(`UPDATE plan_steps SET artifact_id=?, title=?, detail=?, files=?, branch=?, updated_at=? WHERE id=?`)
          .run(artifactId, step.title, step.detail ?? null, JSON.stringify(step.files ?? []), step.branch ?? null, ts, prev.id);
      } else {
        db.prepare(`UPDATE plan_steps SET artifact_id=?, updated_at=? WHERE id=?`).run(artifactId, ts, prev.id);
      }
    } else {
      db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'pending','agent',?,?)`)
        .run(uid("step_"), flowId, artifactId, metaId, ++maxPos, step.title, step.detail ?? null, JSON.stringify(step.files ?? []), step.branch ?? null, ts, ts);
    }
  }
  for (const prev of existingAgent) {
    if (!seen.has(prev.id) && prev.artifact_id !== artifactId) db.prepare(`DELETE FROM plan_steps WHERE id=?`).run(prev.id);
  }
  return steps.length;
}
function setStepStatus(flowId, stepId, status, completedBy) {
  db.prepare(`UPDATE plan_steps SET status=?, completed_by=?, updated_at=? WHERE id=? AND flow_id=?`)
    .run(status, status === "done" ? completedBy ?? "manual" : null, now(), stepId, flowId);
}
function markStepsDone(flowId, refs) {
  const rows = db.prepare(`SELECT * FROM plan_steps WHERE flow_id=? AND status != 'done'`).all(flowId);
  const want = new Set(refs.map((r) => r.trim().toLowerCase()));
  for (const s of rows) {
    if ((s.meta_id && want.has(s.meta_id.toLowerCase())) || want.has(s.title.trim().toLowerCase())) {
      setStepStatus(flowId, s.id, "done", "build");
    }
  }
}
const metaOf = (plan) => JSON.parse(plan.match(/```json plan-meta\s*\n([\s\S]*?)```/)[1]);

function reset() {
  // the seed owns its synthetic task: every flow bound to it goes too (not
  // just the seeded-named one — earlier runs may have bound other flows)
  const flows = db.prepare(`SELECT id FROM flows WHERE name=? OR task_id=?`).all(FLOW_NAME, TASK_ID);
  for (const f of flows) {
    const fid = f.id;
    for (const t of ["plan_steps", "events", "messages", "runs", "artifacts", "comments", "branches", "nodes"])
      db.prepare(`DELETE FROM ${t} WHERE flow_id=?`).run(fid);
    db.prepare(`DELETE FROM flows WHERE id=?`).run(fid);
    console.log(`removed demo flow ${fid}`);
  }
  db.prepare(`DELETE FROM tasks WHERE id=?`).run(TASK_ID);
}

if (RESET) {
  reset();
  console.log("demo reset done");
  process.exit(0);
}

reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = db.prepare(`SELECT id, cloud_url FROM repos ORDER BY created_at LIMIT 1`).get();
db.prepare(`INSERT INTO tasks (id,key,type,summary,description,status,issue_type,priority,repo_url,external_url,raw,fields,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(TASK_ID, "DEMO-142", "jira", "Webhook delivery retries with exponential backoff",
    PRD, "In Progress", "Story", "High",
    repo?.cloud_url ?? null, "https://jira.example.com/browse/DEMO-142", JSON.stringify({ demo: true }),
    JSON.stringify({ prd: PRD, figma_urls: [] }), now());
console.log("task DEMO-142 inserted");

// ── flow (mirrors lib/engine/flow.createFlow) ────────────────────────────────
const flowId = uid("flow_");
const ts0 = now();
db.prepare(`INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(flowId, TASK_ID, FLOW_NAME, "active",
    repo?.cloud_url ?? "https://gitlab.example.com/acme/webapp", repo?.id ?? null, "cloud", ts0, ts0);
const nodeIds = {};
for (const key of ["plan", "build", "pipeline", "review", "resolve"]) {
  const nid = uid("node_");
  nodeIds[key] = nid;
  db.prepare(`INSERT INTO nodes (id,flow_id,node_key,type,status,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)`)
    .run(nid, flowId, key, key, ts0, ts0);
}
console.log(`flow created: ${flowId}`);

const ev = (msg, m, nodeId = nodeIds.plan) => {
  db.prepare(`INSERT INTO events (id,flow_id,node_id,type,message,created_at) VALUES (?,?,?,'lifecycle',?,?)`)
    .run(uid("ev_"), flowId, nodeId, msg, minsAgo(m));
};

function savePlanArtifact(content, meta, version, m) {
  const id = uid("art_");
  db.prepare(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,feedback,created_at)
    VALUES (?,?,?,'plan',?,?,?,?,?,?)`)
    .run(id, nodeIds.plan, flowId, version, content,
      meta ? JSON.stringify(meta) : null,
      version === 2 ? "draft" : "superseded",
      version === 2 ? "Single branch — the pieces are too coupled to split. And the acceptance criteria require tests, add a step for them." : null,
      minsAgo(m));
  return id;
}

// ── act 1: first draft, multi-branch ─────────────────────────────────────────
const metaV1 = metaOf(PLAN_V1);
const artV1 = savePlanArtifact(PLAN_V1, { feedback: null, steps: metaV1.steps, branches: metaV1.branches }, 1, 47);
syncStepsFromPlan(flowId, artV1, metaV1.steps);
ev("plan v1 ready for review (2 branches · 7 steps)", 47);

// dev checked off the two "obvious" ones by hand while reading v1
for (const mid of ["s1", "s2"]) {
  const row = db.prepare(`SELECT id FROM plan_steps WHERE flow_id=? AND meta_id=?`).get(flowId, mid);
  setStepStatus(flowId, row.id, "done", "manual");
  db.prepare(`UPDATE plan_steps SET created_at=?, updated_at=? WHERE id=?`).run(minsAgo(45), minsAgo(44), row.id);
}

// ── act 2: refinement → v2 (s1/s2 stay done; s6 → s9; s8 added) ─────────────
const metaV2 = metaOf(PLAN_V2);
const artV2 = savePlanArtifact(PLAN_V2, { feedback: "single branch + tests step", steps: metaV2.steps }, 2, 30);
syncStepsFromPlan(flowId, artV2, metaV2.steps);
ev("plan v2 ready for review · 8 steps", 30);

// a trial build run on v2 reported two more steps done
markStepsDone(flowId, ["s3", "s4"]);
for (const mid of ["s3", "s4"]) {
  const row = db.prepare(`SELECT id FROM plan_steps WHERE flow_id=? AND meta_id=?`).get(flowId, mid);
  db.prepare(`UPDATE plan_steps SET created_at=?, updated_at=? WHERE id=?`).run(minsAgo(28), minsAgo(12), row.id);
}
ev("build checked off 2 plan steps: Exponential backoff schedule; Delivery executor", 12, nodeIds.build);

// ── act 3: the dev adds a step by hand ───────────────────────────────────────
db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
  VALUES (?,?,?,NULL,?,?,?,NULL,NULL,'pending','user',?,?)`)
  .run(uid("step_"), flowId, artV2, 8,
    "Update ops runbook with retry schedule & replay procedure",
    "So on-call knows what 'dead' means and how to replay.", minsAgo(10), minsAgo(10));
ev("plan checklist edited (9 steps)", 10, null);

// ── final state: plan awaiting approval ──────────────────────────────────────
db.prepare(`UPDATE nodes SET status='awaiting_approval', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ latestArtifact: artV2, version: 2, steps: metaV2.steps }), minsAgo(30), nodeIds.plan);
db.prepare(`UPDATE flows SET current_node=NULL, updated_at=? WHERE id=?`).run(minsAgo(10), flowId);

const final = db.prepare(`SELECT meta_id,title,status,origin,completed_by FROM plan_steps WHERE flow_id=? ORDER BY position`).all(flowId);
console.log("\nchecklist state:");
for (const s of final) {
  console.log(`  [${s.status === "done" ? "x" : " "}] ${s.meta_id ?? "manual"}  ${s.title}` +
    `${s.origin === "user" ? "  (manual)" : ""}${s.completed_by === "build" ? "  (by build)" : ""}`);
}
console.log(`\nopen http://localhost:3000/flows/${flowId}`);
