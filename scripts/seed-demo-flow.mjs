/**
 * Seed a demo flow that showcases the structured plan / editable checklist feature.
 * Plain Node + @prisma/client writes against the demo Postgres database — no TS
 * compile step needed (never import lib/: server-only).
 *
 * Usage:
 *   node scripts/seed-demo-flow.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-demo-flow.mjs --reset   # remove the demo flow + task only
 *
 * Target database: DATABASE_URL, defaulting to the demo DB (devflow). The seed
 * guard refuses any other database (AGENTS.md §1) — see scripts/lib/seed-db.mjs.
 *
 * What you get (open http://localhost:3000 → "DEMO-142 flow"):
 *   - a demo Jira task with a realistic PRD
 *   - a flow with a 2-version plan history (v2 = refined), awaiting approval
 *   - the editable checklist mid-flight: steps done by hand, by build, pending,
 *     one manual step, one superseded-by-refine (gone)
 *   - a lifecycle event trail so the Activity tab tells the story
 */
import {
  deleteTaskDemoFlows,
  minsAgo,
  now,
  openSeedPrisma,
  uid,
} from "./lib/seed-db.mjs";

const TASK_ID = "demo-142";
const FLOW_NAME = "DEMO-142 flow";
const RESET = process.argv.includes("--reset");

const { prisma } = openSeedPrisma();

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

// ── engine replicas (syncStepsFromPlan / markStepsDone from lib/engine/runtime/plan-step-store) ─
async function syncStepsFromPlan(flowId, artifactId, steps) {
  const existingAgent = await prisma.planStep.findMany({ where: { flowId, origin: "agent" } });
  const byMetaId = new Map(existingAgent.filter((s) => s.metaId).map((s) => [s.metaId, s]));
  const seen = new Set();
  const ts = now();
  let maxPos =
    (await prisma.planStep.aggregate({ _max: { position: true }, where: { flowId } }))._max.position ?? -1;
  for (const step of steps) {
    const metaId = step.id ?? null;
    const prev = metaId ? byMetaId.get(metaId) : undefined;
    if (prev) {
      seen.add(prev.id);
      if (prev.status !== "done") {
        await prisma.planStep.update({
          where: { id: prev.id },
          data: {
            artifactId,
            title: step.title,
            detail: step.detail ?? null,
            files: step.files ?? [],
            branch: step.branch ?? null,
            updatedAt: ts,
          },
        });
      } else {
        await prisma.planStep.update({ where: { id: prev.id }, data: { artifactId, updatedAt: ts } });
      }
    } else {
      await prisma.planStep.create({
        data: {
          id: uid("step_"),
          flowId,
          artifactId,
          metaId,
          position: ++maxPos,
          title: step.title,
          detail: step.detail ?? null,
          files: step.files ?? [],
          branch: step.branch ?? null,
          status: "pending",
          origin: "agent",
          createdAt: ts,
          updatedAt: ts,
        },
      });
    }
  }
  for (const prev of existingAgent) {
    if (!seen.has(prev.id) && prev.artifactId !== artifactId) {
      await prisma.planStep.delete({ where: { id: prev.id } });
    }
  }
  return steps.length;
}
async function setStepStatus(flowId, stepId, status, completedBy) {
  await prisma.planStep.updateMany({
    where: { id: stepId, flowId },
    data: {
      status,
      completedBy: status === "done" ? completedBy ?? "manual" : null,
      updatedAt: now(),
    },
  });
}
async function markStepsDone(flowId, refs) {
  const rows = await prisma.planStep.findMany({ where: { flowId, status: { not: "done" } } });
  const want = new Set(refs.map((r) => r.trim().toLowerCase()));
  for (const s of rows) {
    if ((s.metaId && want.has(s.metaId.toLowerCase())) || want.has(s.title.trim().toLowerCase())) {
      await setStepStatus(flowId, s.id, "done", "build");
    }
  }
}
const metaOf = (plan) => JSON.parse(plan.match(/```json plan-meta\s*\n([\s\S]*?)```/)[1]);

async function reset() {
  const flows = await prisma.flow.findMany({
    where: { OR: [{ name: FLOW_NAME }, { taskId: TASK_ID }] },
    select: { id: true },
  });
  for (const f of flows) console.log(`removed demo flow ${f.id}`);
  await deleteTaskDemoFlows(
    prisma,
    TASK_ID,
    flows.map((f) => f.id),
  );
}

if (RESET) {
  await reset();
  console.log("demo reset done");
  process.exit(0);
}

await reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = await prisma.repo.findFirst({ orderBy: { createdAt: "asc" } });
await prisma.task.create({
  data: {
    id: TASK_ID,
    type: "jira",
    key: "DEMO-142",
    summary: "Webhook delivery retries with exponential backoff",
    description: PRD,
    status: "In Progress",
    issueType: "Story",
    priority: "High",
    repoUrl: repo?.cloudUrl ?? null,
    externalUrl: "https://jira.example.com/browse/DEMO-142",
    raw: JSON.stringify({ demo: true }),
    fields: { prd: PRD, figmaUrls: [] },
    syncedAt: now(),
  },
});
console.log("task DEMO-142 inserted");

// ── flow (mirrors lib/engine/flow-engine.createFlow) ────────────────────────────────
const flowId = uid("flow_");
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
console.log(`flow created: ${flowId}`);

const ev = (msg, m, nodeId = nodeIds.plan) =>
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

function savePlanArtifact(content, meta, version, m) {
  return prisma.artifact.create({
    data: {
      id: uid("art_"),
      nodeId: nodeIds.plan,
      flowId,
      kind: "plan",
      version,
      content,
      meta: meta ?? null,
      status: version === 2 ? "draft" : "superseded",
      feedback:
        version === 2
          ? "Single branch — the pieces are too coupled to split. And the acceptance criteria require tests, add a step for them."
          : null,
      createdAt: minsAgo(m),
    },
  }).then((a) => a.id);
}

// ── act 1: first draft, multi-branch ─────────────────────────────────────────
const metaV1 = metaOf(PLAN_V1);
const artV1 = await savePlanArtifact(PLAN_V1, { feedback: null, steps: metaV1.steps, branches: metaV1.branches }, 1, 47);
await syncStepsFromPlan(flowId, artV1, metaV1.steps);
await ev("plan v1 ready for review (2 branches · 7 steps)", 47);

// dev checked off the two "obvious" ones by hand while reading v1
for (const mid of ["s1", "s2"]) {
  const row = await prisma.planStep.findFirst({ where: { flowId, metaId: mid }, select: { id: true } });
  await setStepStatus(flowId, row.id, "done", "manual");
  await prisma.planStep.update({
    where: { id: row.id },
    data: { createdAt: minsAgo(45), updatedAt: minsAgo(44) },
  });
}

// ── act 2: refinement → v2 (s1/s2 stay done; s6 → s9; s8 added) ─────────────
const metaV2 = metaOf(PLAN_V2);
const artV2 = await savePlanArtifact(PLAN_V2, { feedback: "single branch + tests step", steps: metaV2.steps }, 2, 30);
await syncStepsFromPlan(flowId, artV2, metaV2.steps);
await ev("plan v2 ready for review · 8 steps", 30);

// a trial build run on v2 reported two more steps done
await markStepsDone(flowId, ["s3", "s4"]);
for (const mid of ["s3", "s4"]) {
  const row = await prisma.planStep.findFirst({ where: { flowId, metaId: mid }, select: { id: true } });
  await prisma.planStep.update({
    where: { id: row.id },
    data: { createdAt: minsAgo(28), updatedAt: minsAgo(12) },
  });
}
await ev("build checked off 2 plan steps: Exponential backoff schedule; Delivery executor", 12, nodeIds.build);

// ── act 3: the dev adds a step by hand ───────────────────────────────────────
await prisma.planStep.create({
  data: {
    id: uid("step_"),
    flowId,
    artifactId: artV2,
    metaId: null,
    position: 8,
    title: "Update ops runbook with retry schedule & replay procedure",
    detail: "So on-call knows what 'dead' means and how to replay.",
    files: null,
    branch: null,
    status: "pending",
    origin: "user",
    createdAt: minsAgo(10),
    updatedAt: minsAgo(10),
  },
});
await ev("plan checklist edited (9 steps)", 10, null);

// ── final state: plan awaiting approval ──────────────────────────────────────
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: {
    status: "awaiting_approval",
    output: { latestArtifact: artV2, version: 2, steps: metaV2.steps },
    updatedAt: minsAgo(30),
  },
});
await prisma.flow.update({ where: { id: flowId }, data: { updatedAt: minsAgo(10) } });

const final = await prisma.planStep.findMany({ where: { flowId }, orderBy: { position: "asc" } });
console.log("\nchecklist state:");
for (const s of final) {
  console.log(`  [${s.status === "done" ? "x" : " "}] ${s.metaId ?? "manual"}  ${s.title}` +
    `${s.origin === "user" ? "  (manual)" : ""}${s.completedBy === "build" ? "  (by build)" : ""}`);
}
console.log(`\nopen http://localhost:3000/flows/${flowId}`);

await prisma.$disconnect();
