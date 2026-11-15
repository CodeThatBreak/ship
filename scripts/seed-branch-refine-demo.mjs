/**
 * Seed a demo flow that showcases branch-scoped sub-plan refinement
 * (docs/branch-scoped-refine.md). Plain Node + @prisma/client writes against
 * the demo Postgres database — no TS compile step needed.
 *
 * Usage:
 *   node scripts/seed-branch-refine-demo.mjs            # seed (resets demo flow first)
 *   node scripts/seed-branch-refine-demo.mjs --reset    # remove this demo flow + task only
 *
 * Target database: DATABASE_URL, defaulting to the demo DB (devflow). The seed
 * guard refuses any other database (AGENTS.md §1) — see scripts/lib/seed-db.mjs.
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
import { deleteTaskDemoFlows, minsAgo, now, openSeedPrisma, uid } from './lib/seed-db.mjs';

const TASK_ID = 'demo-207';
const FLOW_NAME = 'DEMO-207 sub-plan refine demo';
const RESET = process.argv.includes('--reset');

const { prisma } = openSeedPrisma();

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
const PLAN_V3 = PLAN_V1.replace(
  /## Approach\n[\s\S]*?## Files/,
  `## Approach
Durable outbox → backoff schedule → delivery executor on the backend branch;
poll/deliver/replay on the worker branch. The split stands: the pieces only
communicate through the events table.

## Files`
).replace(
  /- Double delivery if the worker crashes between HTTP success and status write —\n  record the attempt \*before\* delivering\./,
  `- Double delivery on crash between HTTP success and status write — the attempt is\n  recorded *before* the HTTP call (owned by delivery executor).`
);

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
  const taken = new Set(meta.steps.filter(s => s.branch !== branchName).map(s => s.id));
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

  const firstOld = meta.steps.findIndex(s => s.branch === branchName);
  const kept = meta.steps.filter(s => s.branch !== branchName);
  kept.splice(firstOld === -1 ? kept.length : firstOld, 0, ...newSteps);

  const branches = meta.branches.map(b =>
    b.name === branchName
      ? {
          ...b,
          steps: newSteps.map(s => s.title),
          markdown: sub.markdown,
          subPlan: b.subPlan ? { ...b.subPlan, steps: newSteps } : undefined,
        }
      : b
  );
  return { steps: kept, branches };
}

/** replaceBranch — mirrors PlanStepStore.replaceBranch (§5 scoped sync, done state kept via meta_id). */
async function replaceBranch(flowId, artifactId, branchName, steps) {
  const existing = await prisma.planStep.findMany({
    where: { flowId, branch: branchName },
    orderBy: { position: 'asc' },
  });
  const stateByMetaId = new Map(existing.filter(s => s.metaId).map(s => [s.metaId, s]));
  const firstPos = existing.length ? existing[0].position : 0;
  await prisma.planStep.deleteMany({ where: { flowId, branch: branchName } });
  for (const [i, s] of steps.entries()) {
    const prev = s.id ? stateByMetaId.get(s.id) : undefined;
    const status = prev?.status ?? 'pending';
    const completedBy = status === 'done' ? (prev?.completedBy ?? 'manual') : null;
    await prisma.planStep.create({
      data: {
        id: uid('step_'),
        flowId,
        artifactId,
        metaId: s.id ?? null,
        position: firstPos + i,
        title: s.title,
        detail: s.detail ?? null,
        files: s.files ?? [],
        branch: branchName,
        status,
        origin: 'agent',
        completedBy,
        createdAt: now(),
        updatedAt: now(),
      },
    });
  }
  return steps.length;
}

async function setStepStatus(flowId, stepId, status, completedBy) {
  await prisma.planStep.updateMany({
    where: { id: stepId, flowId },
    data: {
      status,
      completedBy: status === 'done' ? (completedBy ?? 'manual') : null,
      updatedAt: now(),
    },
  });
}

// tier-1 meta fixture: the plan node's own steps + branches (v1)
const metaV1 = {
  steps: [
    {
      id: 's1',
      title: 'Create webhook_events outbox table',
      detail: 'Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.',
      files: ['db/migrations/014_webhook_events.sql'],
      branch: 'backend',
    },
    {
      id: 's2',
      title: 'Outbox writer + state machine',
      detail: 'persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.',
      files: ['lib/webhooks/outbox.ts'],
      branch: 'backend',
    },
    {
      id: 's3',
      title: 'Exponential backoff schedule',
      detail: '1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.',
      files: ['lib/webhooks/backoff.ts'],
      branch: 'backend',
    },
    {
      id: 's4',
      title: 'Delivery executor',
      detail: 'POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.',
      files: ['lib/webhooks/deliver.ts'],
      branch: 'backend',
    },
    {
      id: 's5',
      title: 'Retry worker loop',
      detail: 'Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.',
      files: ['workers/webhook-retry.ts'],
      branch: 'worker',
    },
    {
      id: 's6',
      title: 'Publish path via outbox',
      detail: 'app/api/webhooks/route.ts writes to the outbox instead of firing directly.',
      files: ['app/api/webhooks/route.ts'],
      branch: 'backend',
    },
    {
      id: 's7',
      title: 'Admin replay endpoint',
      detail: 'POST /admin/webhooks/:id/replay resets a dead event to pending.',
      files: ['app/api/admin/webhooks/[id]/replay/route.ts'],
      branch: 'worker',
    },
  ],
  branches: [
    {
      name: 'backend',
      title: 'Outbox, backoff & delivery core',
      scope: 'Schema, outbox writer, backoff, delivery executor, publish-path rewiring',
      files: [
        'db/migrations/014_webhook_events.sql',
        'lib/webhooks/outbox.ts',
        'lib/webhooks/backoff.ts',
        'lib/webhooks/deliver.ts',
        'app/api/webhooks/route.ts',
      ],
      steps: ['s1', 's2', 's3', 's4', 's6'],
      dependsOn: [],
      subPlan: {
        prompt:
          'Plan the outbox schema, state machine, backoff function and delivery executor for the webhook retry pipeline. Keep the publish path returning 202 after the outbox write.',
      },
    },
    {
      name: 'worker',
      title: 'Retry worker + admin replay',
      scope: 'Background retry loop and the admin replay endpoint',
      files: ['workers/webhook-retry.ts', 'app/api/admin/webhooks/[id]/replay/route.ts'],
      steps: ['s5', 's7'],
      dependsOn: ['backend'],
      subPlan: {
        prompt:
          'Plan the background retry loop (poll due events, deliver, reschedule or dead-letter) and the admin replay endpoint. Assume the backend outbox, backoff schedule and delivery executor already exist.',
      },
    },
  ],
};

// What PlanStore.persistPlan publishes in `follow` mode (plan fan-out §1):
// the planner's per-branch fan-out decision rides EVERY plan version in
// artifacts.meta, so the plan panel/approve footer show the published
// resolution ("steps" — one child flow per branch) with its rationale.
const PLANNER_EXECUTION = {
  execution: 'steps',
  executionSource: 'planner',
  execution_rationale:
    'Two independent branches (schema/delivery core vs worker loop) a reviewer can verify one at a time',
};

// ── v2 scoped refine input: the "agent response" for worker ──────────────────
const SUB_WORKER_V2 = {
  markdown: WORKER_DOC_V2,
  steps: [
    // s5 reworded (id reused → surfaces as `changed` in the diff)
    {
      id: 's5',
      title: 'Retry worker loop',
      detail:
        'Poll due events via the (status, next_attempt_at) index; one claim UPDATE keeps the loop single-owner. Crash-safe.',
      files: ['workers/webhook-retry.ts'],
      branch: 'worker',
    },
    // s7 unchanged → id preserved → absent from the diff
    {
      id: 's7',
      title: 'Admin replay endpoint',
      detail: 'POST /admin/webhooks/:id/replay resets a dead event to pending; rejects non-dead with 409.',
      files: ['app/api/admin/webhooks/[id]/replay/route.ts'],
      branch: 'worker',
    },
    // s9 added
    {
      id: 's9',
      title: 'Stale-retry sweep on worker start',
      detail: 'A retrying row older than 24h is swept back to pending on worker start — self-heals lost attempts.',
      files: ['workers/webhook-retry.ts'],
      branch: 'worker',
    },
  ],
};

// ── v4 scoped refine input: the "agent response" for backend ─────────────────
const SUB_BACKEND_V4 = {
  markdown: BACKEND_DOC_V4,
  steps: [
    {
      id: 's1',
      title: 'Create webhook_events outbox table',
      detail:
        'Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated. Adds the (status, next_attempt_at) index the worker polls with.',
      files: ['db/migrations/014_webhook_events.sql'],
      branch: 'backend',
    },
    {
      id: 's2',
      title: 'Outbox writer + state machine',
      detail: 'persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.',
      files: ['lib/webhooks/outbox.ts'],
      branch: 'backend',
    },
    {
      id: 's3',
      title: 'Exponential backoff schedule',
      detail: '1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.',
      files: ['lib/webhooks/backoff.ts'],
      branch: 'backend',
    },
    {
      id: 's4',
      title: 'Delivery executor',
      detail:
        'POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead. One claim UPDATE holds ownership.',
      files: ['lib/webhooks/deliver.ts'],
      branch: 'backend',
    },
    {
      id: 's6',
      title: 'Publish path via outbox',
      detail: 'app/api/webhooks/route.ts writes to the outbox and returns 202.',
      files: ['app/api/webhooks/route.ts'],
      branch: 'backend',
    },
  ],
};

// ── helpers ──────────────────────────────────────────────────────────────────
async function reset() {
  const flows = await prisma.flow.findMany({
    where: { OR: [{ name: FLOW_NAME }, { taskId: TASK_ID }] },
    select: { id: true },
  });
  for (const f of flows) console.log(`removed demo flow ${f.id}`);
  await deleteTaskDemoFlows(
    prisma,
    TASK_ID,
    flows.map(f => f.id)
  );
}

if (RESET) {
  await reset();
  console.log('branch-refine demo reset done');
  process.exit(0);
}

await reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = await prisma.repo.findFirst({ orderBy: { createdAt: 'asc' } });
await prisma.task.create({
  data: {
    id: TASK_ID,
    type: 'jira',
    key: 'DEMO-207',
    summary: 'Webhook delivery retries (branch-scoped sub-plan refine demo)',
    description: PRD,
    status: 'In Progress',
    issueType: 'Story',
    priority: 'High',
    repoUrl: repo?.cloudUrl ?? null,
    externalUrl: 'https://jira.example.com/browse/DEMO-207',
    raw: JSON.stringify({ demo: true }),
    fields: { prd: PRD, figmaUrls: [] },
    syncedAt: now(),
  },
});

// ── flow + nodes ─────────────────────────────────────────────────────────────
const flowId = uid('flow_');
const ts0 = now();
await prisma.flow.create({
  data: {
    id: flowId,
    taskId: TASK_ID,
    name: FLOW_NAME,
    status: 'active',
    repoUrl: repo?.cloudUrl ?? 'https://gitlab.example.com/acme/webapp',
    repoId: repo?.id ?? null,
    executionMode: 'cloud',
    createdAt: ts0,
    updatedAt: ts0,
  },
});
const nodeIds = {};
for (const key of ['plan', 'build', 'pipeline', 'review', 'resolve']) {
  const nid = uid('node_');
  nodeIds[key] = nid;
  await prisma.node.create({
    data: {
      id: nid,
      flowId,
      nodeKey: key,
      type: key,
      status: 'pending',
      createdAt: ts0,
      updatedAt: ts0,
    },
  });
}
console.log(`flow created: ${flowId}`);

// the plan node's knob: `follow` — the PLANNER decides per plan version
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: { config: { execution_default: 'follow' } },
});

const ev = (msg, m, nodeId = nodeIds.plan) =>
  prisma.event.create({
    data: {
      id: uid('ev_'),
      flowId,
      nodeId,
      type: 'lifecycle',
      message: msg,
      createdAt: minsAgo(m),
    },
  });

let nodeInput = { prompt: null, promptIsBody: false, model: null, contextBlocks: [] };
const setNodeInput = async i => {
  nodeInput = { ...nodeInput, ...i };
  await prisma.node.update({
    where: { id: nodeIds.plan },
    data: { input: nodeInput, updatedAt: now() },
  });
};

function savePlanArtifact(content, meta, version, m, feedback = null) {
  return prisma.artifact
    .create({
      data: {
        id: uid('art_'),
        nodeId: nodeIds.plan,
        flowId,
        kind: 'plan',
        version,
        content,
        meta,
        status: version === 4 ? 'draft' : 'superseded',
        feedback,
        createdAt: minsAgo(m),
      },
    })
    .then(a => ({ id: a.id, version }));
}

// ── act 1 (t-52m): plan v1, 2 branches ────────────────────────────────────────
const artV1 = await savePlanArtifact(
  PLAN_V1,
  { feedback: null, steps: metaV1.steps, branches: metaV1.branches, ...PLANNER_EXECUTION },
  1,
  52
);
const insStep = (s, pos) =>
  prisma.planStep.create({
    data: {
      id: uid('step_'),
      flowId,
      artifactId: artV1.id,
      metaId: s.id,
      position: pos,
      title: s.title,
      detail: s.detail ?? null,
      files: s.files ?? [],
      branch: s.branch ?? null,
      status: 'pending',
      origin: 'agent',
      createdAt: minsAgo(52),
      updatedAt: minsAgo(52),
    },
  });
for (const [i, s] of metaV1.steps.entries()) await insStep(s, i);
await ev('plan v1 ready for review (2 branches · 7 steps)', 52);
await ev(
  'planner decided execution "steps" — one child flow per branch on approval ("Two independent branches a reviewer can verify one at a time")',
  52.5
);

// dev checked off the two "obvious" backend steps by hand while reading v1
for (const mid of ['s1', 's2']) {
  const row = await prisma.planStep.findFirst({ where: { flowId, metaId: mid }, select: { id: true } });
  await setStepStatus(flowId, row.id, 'done', 'manual');
}
await ev('plan checklist edited (done: s1, s2)', 46, null);

// a manual user step, branch-unassigned — scoped refines must never clobber it
await prisma.planStep.create({
  data: {
    id: uid('step_'),
    flowId,
    artifactId: artV1.id,
    metaId: null,
    position: 8,
    title: 'Update ops runbook with retry schedule & replay procedure',
    detail: "So on-call knows what 'dead' means and how to replay.",
    files: null,
    branch: null,
    status: 'pending',
    origin: 'user',
    createdAt: minsAgo(44),
    updatedAt: minsAgo(44),
  },
});
await ev('plan checklist edited (9 steps)', 44, null);

// ── act 2 (t-31m): branch-scoped refine of `worker` → v2 ─────────────────────
// (fresh agent, context blocks: task + contract + current)
await setNodeInput({ contextBlocks: ['task', 'contract', 'current'], planThread: 'worker' });
await ev('sub-plan refine (worker, fresh) validation failed — retrying with feedback (1 error)', 36);
const mergedV2 = mergeBranchRefine(metaV1, 'worker', SUB_WORKER_V2);
const artV2 = await savePlanArtifact(
  PLAN_V1, // ← plan markdown byte-identical: only the branch doc carries the change
  {
    feedback: null,
    steps: mergedV2.steps,
    branches: mergedV2.branches,
    scopedRefine: { branch: 'worker', from: 1 },
    ...PLANNER_EXECUTION,
  },
  2,
  31
);
await replaceBranch(
  flowId,
  artV2.id,
  'worker',
  mergedV2.steps.filter(s => s.branch === 'worker')
);
const workerDiff = { added: 1, removed: 0, changed: 1 };
await ev(
  `branch 'worker' sub-plan refined · 3 steps (+${workerDiff.added} / −${workerDiff.removed}, ${workerDiff.changed} changed) — other branches untouched`,
  31
);

// dev reads the branch tab, then hands off a whole-plan nudge
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: {
    status: 'awaiting_approval',
    output: {
      latestArtifact: artV2.id,
      version: 2,
      branches: mergedV2.branches,
      steps: mergedV2.steps,
      scopedRefine: { branch: 'worker', from: 1 },
    },
    updatedAt: minsAgo(31),
  },
});

// ── act 3 (t-14m): whole-plan refine → v3 (overview prose refreshed) ─────────
await setNodeInput({ contextBlocks: ['task', 'branches', 'edits'] });
const metaV3 = { steps: mergedV2.steps, branches: mergedV2.branches }; // steps untouched — prose only
const artV3 = await savePlanArtifact(
  PLAN_V3,
  {
    feedback: 'tighten the overview prose after the worker refine',
    steps: metaV3.steps,
    branches: metaV3.branches,
    ...PLANNER_EXECUTION,
  },
  3,
  14,
  'tighten the overview prose after the worker refine'
);
await prisma.planStep.updateMany({ where: { flowId }, data: { artifactId: artV3.id } });
await ev(`plan v3 ready for review (2 branches · 8 steps)`, 14);
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: {
    status: 'awaiting_approval',
    output: { latestArtifact: artV3.id, version: 3, branches: metaV3.branches, steps: metaV3.steps },
    updatedAt: minsAgo(14),
  },
});

// ── act 4 (t-2m): branch-scoped refine of `backend` → v4 ─────────────────────
await setNodeInput({ contextBlocks: ['task', 'contract', 'current'], planThread: 'backend' });
const mergedV4 = mergeBranchRefine(metaV3, 'backend', SUB_BACKEND_V4);
const artV4 = await savePlanArtifact(
  PLAN_V3,
  {
    feedback: null,
    steps: mergedV4.steps,
    branches: mergedV4.branches,
    scopedRefine: { branch: 'backend', from: 3 },
    ...PLANNER_EXECUTION,
  },
  4,
  2
);
await replaceBranch(
  flowId,
  artV4.id,
  'backend',
  mergedV4.steps.filter(s => s.branch === 'backend')
);
// backend diff vs v3: s4 detail reworded (changed), s9 note pulled into s1 (changed), nothing else
await prisma.node.update({
  where: { id: nodeIds.plan },
  data: {
    status: 'awaiting_approval',
    output: {
      latestArtifact: artV4.id,
      version: 4,
      branches: mergedV4.branches,
      steps: mergedV4.steps,
      scopedRefine: { branch: 'backend', from: 3 },
    },
    updatedAt: minsAgo(2),
  },
});
await prisma.flow.update({ where: { id: flowId }, data: { currentNode: null, updatedAt: minsAgo(2) } });
await ev("branch 'backend' sub-plan refined · 5 steps (+0 / −0, 2 changed) — other branches untouched", 2);

const final = await prisma.planStep.findMany({
  where: { flowId },
  orderBy: { position: 'asc' },
});
console.log("\nchecklist state (scoped refines never touched other branches' rows):");
for (const s of final) {
  console.log(
    `  [${s.status === 'done' ? 'x' : ' '}] ${(s.branch ?? '—').padEnd(8)} ${s.metaId ?? 'manual'}  ${s.title}` +
      `${s.origin === 'user' ? '  (manual)' : ''}${s.completedBy === 'manual' ? '  (done by dev)' : ''}`
  );
}
console.log(
  `\noverview bytes: v1=${Buffer.byteLength(PLAN_V1)} v2=${Buffer.byteLength(PLAN_V1)} (identical) · branch docs written by scoped refines only`
);
console.log(`open http://localhost:3000/flows/${flowId}`);

await prisma.$disconnect();
