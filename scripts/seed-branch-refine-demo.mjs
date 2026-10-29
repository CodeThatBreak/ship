/**
 * Seed a demo flow that showcases branch-scoped sub-plan refinement
 * (docs/branch-scoped-refine.md). Zero-dependency: plain Node + better-sqlite3.
 *
 * Usage:
 *   node scripts/seed-branch-refine-demo.mjs            # seed (resets demo flow first)
 *   node scripts/seed-branch-refine-demo.mjs --reset    # remove this demo flow + task only
 *   node scripts/seed-branch-refine-demo.mjs --serve    # + start `next dev` on :3000
 *
 * The story it seeds (open http://localhost:3000 → "DEMO-207 sub-plan refine demo"):
 *   v1  plan, 2 branches (backend, worker), 7 steps
 *   v2  branch-scoped refine of `worker`  → ONLY that branch's steps change,
 *       the plan markdown stays byte-identical, worker gets its own branch doc,
 *       diffs via id preservation (s5 changed, s9 added, s7 untouched)
 *   v3  whole-plan refine → rewritten overview prose (worker doc from v2 not stale yet)
 *   v4  branch-scoped refine of `backend` → diff banner (backend, v3→v4) +
 *       staleness signals (backend doc v4 > overview v3), checklist rows of
 *       other branches untouched, manual row never clobbered
 *
 * The plan node also publishes the split-units state (plan fan-out §1): the
 * knob is `execution_default: follow` and every plan version's meta carries
 * the planner's decision `execution: "steps"` (one child flow per branch on
 * approval), so the approve footer shows the published resolution, its
 * rationale and the Force-whole override — exactly what PlanStore.persistPlan
 * publishes at run time.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSeedDb } from "./lib/seed-db.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TASK_ID = "demo-207";
const FLOW_NAME = "DEMO-207 sub-plan refine demo";
const RESET = process.argv.includes("--reset");
const SERVE = process.argv.includes("--serve");

const dbFile = resolveSeedDb(root);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));

const now = () => new Date().toISOString();
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ── demo task: the webhook-retry PRD has enough surface for two branches ──
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

## Acceptance criteria
- Killing the delivery worker mid-retry loses no events.
- A subscriber that fails 4 times then succeeds receives the event exactly once
  on the 5th attempt.
- Dead events are replayable via POST /admin/webhooks/:id/replay.
- Unit tests cover backoff schedule calculation and the outbox state machine.`;

// ── plan v1: branched draft, 2 branches, 7 steps (byte-identical across v1/v2) ─
const PLAN_V1 = `# Webhook retry pipeline — implementation plan

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
  4× then succeeds → exactly-once on attempt 5.`;

// ── plan v3 overview: whole-plan refine rewrote the prose ONLY ───────────────
const PLAN_V3 = PLAN_V1
  .replace(/## Approach\n[\s\S]*?## Files/, `## Approach
Durable outbox → backoff schedule → delivery executor on the backend branch;
poll/deliver/replay on the worker branch. The split stands: the pieces only
communicate through the events table.

## Files`)
  .replace(/- Double delivery if the worker crashes between HTTP success and status write —\n  record the attempt \*before\* delivering\./,
    `- Double delivery on crash between HTTP success and status write — the attempt is\n  recorded *before* the HTTP call (owned by delivery executor).`);

// ── branch sub-plan markdown (what a scoped refine writes into the branch)
const WORKER_DOC_V2 = `# Retry worker — sub-plan (refined)

> Branch-scoped refine of \`worker\` — assumes the \`backend\` contract is done:
> outbox table + writer, backoff schedule, delivery executor.

## Work
1. Poll due events from \`webhook_events\` using the \`(status, next_attempt_at)\`
   index; one claim UPDATE keeps the loop single-owner.
2. Deliver through the shared executor — attempt is recorded **before** the HTTP
   call, so a crash can never skip a retry.
3. Dead-letter after 5 attempts; a stray \`retrying\` row older than 24h is
   swept back to pending on worker start (new safety net).

## Admin replay
- \`POST /admin/webhooks/:id/replay\` resets a dead event to pending and returns
  the delivery history for verification.
- Replay rejects non-dead statuses with 409.

## Testing
- Crash-recovery: kill mid-retry, restart, assert no event lost.
- Exactly-once: subscriber fails 4× then succeeds on attempt 5.`;

const BACKEND_DOC_V4 = `# Outbox & delivery core — sub-plan (refined)

> Branch-scoped refine of \`backend\` — the worker's side (poll/replay) is
> planned elsewhere and untouched.

## Work
1. Migration 014: \`webhook_events\` (payload, status, attempts,
   next_attempt_at, last_error) + \`(status, next_attempt_at)\` index.
2. Outbox state machine: pending → delivered | retrying | dead, attempt
   counters bumped transactionally with the payload write.
3. Backoff schedule as a pure function: 1m → 5m → 30m → 2h → 6h, ±20% jitter.
4. Delivery executor: attempt recorded BEFORE the HTTP call; 2xx classification
   is the only success path.
5. Publish path writes to the outbox first and returns 202.

## Not in this branch
- Poll loop, replay endpoint, audit trail — owned by \`worker\`.

## Testing
- Backoff schedule unit tests (exact + jitter bounds), every outbox transition
  including illegal ones.`;

// ── engine replicas ──────────────────────────────────────────────────────────
/** mergeBranchRefine — mirrors lib/engine/nodes/kinds/plan/plan-node.ts (§5). */
function mergeBranchRefine(meta, branchName, sub) {
  const taken = new Set(meta.steps.filter((s) => s.branch !== branchName).map((s) => s.id));
  const reId = (s, i) => {
    let id = s.id?.trim() || `s${i + 1}`;
    if (taken.has(id)) {
      let n = taken.size + 1;
      while (taken.has(`s${n}`)) n++;
      id = `s${n}`;
    }
    taken.add(id);
    return { ...s, id, branch: branchName };
  };
  const newSteps = sub.steps.map(reId);

  const firstOld = meta.steps.findIndex((s) => s.branch === branchName);
  const kept = meta.steps.filter((s) => s.branch !== branchName);
  kept.splice(firstOld === -1 ? kept.length : firstOld, 0, ...newSteps);

  const branches = meta.branches.map((b) =>
    b.name === branchName
      ? { ...b, steps: newSteps.map((s) => s.title), markdown: sub.markdown,
          subPlan: b.subPlan ? { ...b.subPlan, steps: newSteps } : undefined }
      : b
  );
  return { steps: kept, branches };
}

/** replaceBranch — mirrors PlanStepStore.replaceBranch (§5 scoped sync, done state kept via meta_id). */
function replaceBranch(flowId, artifactId, branchName, steps) {
  const existing = db.prepare(`SELECT * FROM plan_steps WHERE flow_id=? AND branch=?`).all(flowId, branchName);
  const stateByMetaId = new Map(existing.filter((s) => s.meta_id).map((s) => [s.meta_id, s]));
  const firstPos = existing.length ? existing[0].position : 0;
  db.prepare(`DELETE FROM plan_steps WHERE flow_id=? AND branch=?`).run(flowId, branchName);
  steps.forEach((s, i) => {
    const prev = s.id ? stateByMetaId.get(s.id) : undefined;
    const status = prev?.status ?? "pending";
    const completedBy = status === "done" ? prev?.completed_by ?? "manual" : null;
    db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,completed_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid("step_"), flowId, artifactId, s.id ?? null, firstPos + i, s.title, s.detail ?? null,
        JSON.stringify(s.files ?? []), branchName, status, "agent", completedBy, now(), now());
  });
  return steps.length;
}

function setStepStatus(flowId, stepId, status, completedBy) {
  db.prepare(`UPDATE plan_steps SET status=?, completed_by=?, updated_at=? WHERE id=? AND flow_id=?`)
    .run(status, status === "done" ? completedBy ?? "manual" : null, now(), stepId, flowId);
}

// tier-1 meta fixture: the plan node's own steps + branches (v1)
const metaV1 = {
  steps: [
    { id: "s1", title: "Create webhook_events outbox table", detail: "Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.", files: ["db/migrations/014_webhook_events.sql"], branch: "backend" },
    { id: "s2", title: "Outbox writer + state machine", detail: "persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.", files: ["lib/webhooks/outbox.ts"], branch: "backend" },
    { id: "s3", title: "Exponential backoff schedule", detail: "1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.", files: ["lib/webhooks/backoff.ts"], branch: "backend" },
    { id: "s4", title: "Delivery executor", detail: "POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.", files: ["lib/webhooks/deliver.ts"], branch: "backend" },
    { id: "s5", title: "Retry worker loop", detail: "Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.", files: ["workers/webhook-retry.ts"], branch: "worker" },
    { id: "s6", title: "Publish path via outbox", detail: "app/api/webhooks/route.ts writes to the outbox instead of firing directly.", files: ["app/api/webhooks/route.ts"], branch: "backend" },
    { id: "s7", title: "Admin replay endpoint", detail: "POST /admin/webhooks/:id/replay resets a dead event to pending.", files: ["app/api/admin/webhooks/[id]/replay/route.ts"], branch: "worker" },
  ],
  branches: [
    { name: "backend", title: "Outbox, backoff & delivery core", scope: "Schema, outbox writer, backoff, delivery executor, publish-path rewiring",
      files: ["db/migrations/014_webhook_events.sql", "lib/webhooks/outbox.ts", "lib/webhooks/backoff.ts", "lib/webhooks/deliver.ts", "app/api/webhooks/route.ts"],
      steps: ["s1", "s2", "s3", "s4", "s6"], dependsOn: [],
      subPlan: { prompt: "Plan the outbox schema, state machine, backoff function and delivery executor for the webhook retry pipeline. Keep the publish path returning 202 after the outbox write." } },
    { name: "worker", title: "Retry worker + admin replay", scope: "Background retry loop and the admin replay endpoint",
      files: ["workers/webhook-retry.ts", "app/api/admin/webhooks/[id]/replay/route.ts"],
      steps: ["s5", "s7"], dependsOn: ["backend"],
      subPlan: { prompt: "Plan the background retry loop (poll due events, deliver, reschedule or dead-letter) and the admin replay endpoint. Assume the backend outbox, backoff schedule and delivery executor already exist." } },
  ],
};

// What PlanStore.persistPlan publishes in `follow` mode (plan fan-out §1):
// the planner's per-branch fan-out decision rides EVERY plan version in
// artifacts.meta, so the plan panel/approve footer show the published
// resolution ("steps" — one child flow per branch) with its rationale.
const PLANNER_EXECUTION = {
  execution: "steps",
  executionSource: "planner",
  execution_rationale:
    "Two independent branches (schema/delivery core vs worker loop) a reviewer can verify one at a time",
};

// ── v2 scoped refine input: the "agent response" for worker ──────────────────
const SUB_WORKER_V2 = {
  markdown: WORKER_DOC_V2,
  steps: [
    // s5 reworded (id reused → surfaces as `changed` in the diff)
    { id: "s5", title: "Retry worker loop", detail: "Poll due events via the (status, next_attempt_at) index; one claim UPDATE keeps the loop single-owner. Crash-safe.", files: ["workers/webhook-retry.ts"], branch: "worker" },
    // s7 unchanged → id preserved → absent from the diff
    { id: "s7", title: "Admin replay endpoint", detail: "POST /admin/webhooks/:id/replay resets a dead event to pending; rejects non-dead with 409.", files: ["app/api/admin/webhooks/[id]/replay/route.ts"], branch: "worker" },
    // s9 added
    { id: "s9", title: "Stale-retry sweep on worker start", detail: "A retrying row older than 24h is swept back to pending on worker start — self-heals lost attempts.", files: ["workers/webhook-retry.ts"], branch: "worker" },
  ],
};

// ── v4 scoped refine input: the "agent response" for backend ─────────────────
const SUB_BACKEND_V4 = {
  markdown: BACKEND_DOC_V4,
  steps: [
    { id: "s1", title: "Create webhook_events outbox table", detail: "Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated. Adds the (status, next_attempt_at) index the worker polls with.", files: ["db/migrations/014_webhook_events.sql"], branch: "backend" },
    { id: "s2", title: "Outbox writer + state machine", detail: "persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.", files: ["lib/webhooks/outbox.ts"], branch: "backend" },
    { id: "s3", title: "Exponential backoff schedule", detail: "1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.", files: ["lib/webhooks/backoff.ts"], branch: "backend" },
    { id: "s4", title: "Delivery executor", detail: "POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead. One claim UPDATE holds ownership.", files: ["lib/webhooks/deliver.ts"], branch: "backend" },
    { id: "s6", title: "Publish path via outbox", detail: "app/api/webhooks/route.ts writes to the outbox and returns 202.", files: ["app/api/webhooks/route.ts"], branch: "backend" },
  ],
};

// ── helpers ──────────────────────────────────────────────────────────────────
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
  console.log("branch-refine demo reset done");
  process.exit(0);
}

reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = db.prepare(`SELECT id, cloud_url FROM repos ORDER BY created_at LIMIT 1`).get();
db.prepare(`INSERT INTO tasks (id,key,type,summary,description,status,issue_type,priority,repo_url,external_url,raw,fields,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(TASK_ID, "DEMO-207", "jira", "Webhook delivery retries (branch-scoped sub-plan refine demo)",
    PRD, "In Progress", "Story", "High",
    repo?.cloud_url ?? null, "https://jira.example.com/browse/DEMO-207", JSON.stringify({ demo: true }),
    JSON.stringify({ prd: PRD, figma_urls: [] }), now());

// ── flow + nodes ─────────────────────────────────────────────────────────────
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

// the plan node's knob: `follow` — the PLANNER decides per plan version
db.prepare(`UPDATE nodes SET config=? WHERE id=?`).run(JSON.stringify({ execution_default: "follow" }), nodeIds.plan);

const ev = (msg, m, nodeId = nodeIds.plan) => {
  db.prepare(`INSERT INTO events (id,flow_id,node_id,type,message,created_at) VALUES (?,?,?,'lifecycle',?,?)`)
    .run(uid("ev_"), flowId, nodeId, msg, minsAgo(m));
};

let nodeInput = { feedback: null, prompt: null, promptIsBody: false, decompose: false, model: null, branchRef: null, fresh: null, contextBlocks: [] };
const setNodeInput = (i) => {
  nodeInput = { ...nodeInput, ...i };
  db.prepare(`UPDATE nodes SET input=?, updated_at=? WHERE id=?`).run(JSON.stringify(nodeInput), now(), nodeIds.plan);
};

function savePlanArtifact(content, meta, version, m, feedback = null) {
  const id = uid("art_");
  db.prepare(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,feedback,created_at)
    VALUES (?,?,?,'plan',?,?,?,?,?,?)`)
    .run(id, nodeIds.plan, flowId, version, content, JSON.stringify(meta),
      version === 4 ? "draft" : "superseded", feedback, minsAgo(m));
  return { id, version };
}

// ── act 1 (t-52m): plan v1, 2 branches ────────────────────────────────────────
const artV1 = savePlanArtifact(PLAN_V1, { feedback: null, steps: metaV1.steps, branches: metaV1.branches, ...PLANNER_EXECUTION }, 1, 52);
const insStep = (s, pos) =>
  db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending','agent',?,?)`)
    .run(uid("step_"), flowId, artV1.id, s.id, pos, s.title, s.detail ?? null, JSON.stringify(s.files ?? []), s.branch ?? null, minsAgo(52), minsAgo(52));
metaV1.steps.forEach(insStep);
ev("plan v1 ready for review (2 branches · 7 steps)", 52);
ev('planner decided execution "steps" — one child flow per branch on approval ("Two independent branches a reviewer can verify one at a time")', 52.5);

// dev checked off the two "obvious" backend steps by hand while reading v1
for (const mid of ["s1", "s2"]) {
  const row = db.prepare(`SELECT id FROM plan_steps WHERE flow_id=? AND meta_id=?`).get(flowId, mid);
  setStepStatus(flowId, row.id, "done", "manual");
}
ev("plan checklist edited (done: s1, s2)", 46, null);

// a manual user step, branch-unassigned — scoped refines must never clobber it
db.prepare(`INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
  VALUES (?,?,?,NULL,?,?,?,NULL,NULL,'pending','user',?,?)`)
  .run(uid("step_"), flowId, artV1.id, 8,
    "Update ops runbook with retry schedule & replay procedure",
    "So on-call knows what 'dead' means and how to replay.", minsAgo(44), minsAgo(44));
ev("plan checklist edited (9 steps)", 44, null);

// ── act 2 (t-31m): branch-scoped refine of `worker` → v2 ─────────────────────
// (fresh agent, context blocks: task + contract + current)
setNodeInput({ branchRef: "worker", fresh: true, contextBlocks: ["task", "contract", "current"] });
ev('sub-plan refine (worker, fresh) validation failed — retrying with feedback (1 error)', 36);
const mergedV2 = mergeBranchRefine(metaV1, "worker", SUB_WORKER_V2);
const artV2 = savePlanArtifact(PLAN_V1, // ← plan markdown byte-identical: only the branch doc carries the change
  { feedback: null, steps: mergedV2.steps, branches: mergedV2.branches, scopedRefine: { branch: "worker", from: 1 }, ...PLANNER_EXECUTION },
  2, 31);
replaceBranch(flowId, artV2.id, "worker", mergedV2.steps.filter((s) => s.branch === "worker"));
const workerDiff = { added: 1, removed: 0, changed: 1 };
ev(`branch 'worker' sub-plan refined · 3 steps (+${workerDiff.added} / −${workerDiff.removed}, ${workerDiff.changed} changed) — other branches untouched`, 31);

// dev reads the branch tab, then hands off a whole-plan nudge
db.prepare(`UPDATE nodes SET status='awaiting_approval', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ latestArtifact: artV2.id, version: 2, branches: mergedV2.branches, steps: mergedV2.steps, scopedRefine: { branch: "worker", from: 1 } }),
    minsAgo(31), nodeIds.plan);

// ── act 3 (t-14m): whole-plan refine → v3 (overview prose refreshed) ─────────
setNodeInput({ branchRef: null, fresh: true, contextBlocks: ["task", "branches", "edits"] });
const metaV3 = { steps: mergedV2.steps, branches: mergedV2.branches }; // steps untouched — prose only
const artV3 = savePlanArtifact(PLAN_V3, { feedback: "tighten the overview prose after the worker refine", steps: metaV3.steps, branches: metaV3.branches, ...PLANNER_EXECUTION }, 3, 14,
  "tighten the overview prose after the worker refine");
db.prepare(`UPDATE plan_steps SET artifact_id=? WHERE flow_id=?`).run(artV3.id, flowId);
ev(`plan v3 ready for review (2 branches · 8 steps)`, 14);
db.prepare(`UPDATE nodes SET status='awaiting_approval', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ latestArtifact: artV3.id, version: 3, branches: metaV3.branches, steps: metaV3.steps}),
    minsAgo(14), nodeIds.plan);

// ── act 4 (t-2m): branch-scoped refine of `backend` → v4 ─────────────────────
setNodeInput({ branchRef: "backend", fresh: true, contextBlocks: ["task", "contract", "current"] });
const mergedV4 = mergeBranchRefine(metaV3, "backend", SUB_BACKEND_V4);
const artV4 = savePlanArtifact(PLAN_V3,
  { feedback: null, steps: mergedV4.steps, branches: mergedV4.branches, scopedRefine: { branch: "backend", from: 3 }, ...PLANNER_EXECUTION },
  4, 2);
replaceBranch(flowId, artV4.id, "backend", mergedV4.steps.filter((s) => s.branch === "backend"));
// backend diff vs v3: s4 detail reworded (changed), s9 note pulled into s1 (changed), nothing else
db.prepare(`UPDATE nodes SET status='awaiting_approval', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ latestArtifact: artV4.id, version: 4, branches: mergedV4.branches, steps: mergedV4.steps, scopedRefine: { branch: "backend", from: 3 } }),
    minsAgo(2), nodeIds.plan);
db.prepare(`UPDATE flows SET current_node=NULL, updated_at=? WHERE id=?`).run(minsAgo(2), flowId);
ev("branch 'backend' sub-plan refined · 5 steps (+0 / −0, 2 changed) — other branches untouched", 2);

const final = db.prepare(`SELECT meta_id,title,status,branch,origin,completed_by FROM plan_steps WHERE flow_id=? ORDER BY position`).all(flowId);
console.log("\nchecklist state (scoped refines never touched other branches' rows):");
for (const s of final) {
  console.log(`  [${s.status === "done" ? "x" : " "}] ${(s.branch ?? "—").padEnd(8)} ${s.meta_id ?? "manual"}  ${s.title}` +
    `${s.origin === "user" ? "  (manual)" : ""}${s.completed_by === "manual" ? "  (done by dev)" : ""}`);
}
console.log(`\noverview bytes: v1=${Buffer.byteLength(PLAN_V1)} v2=${Buffer.byteLength(PLAN_V1)} (identical) · branch docs written by scoped refines only`);
console.log(`open http://localhost:3000/flows/${flowId}`);
