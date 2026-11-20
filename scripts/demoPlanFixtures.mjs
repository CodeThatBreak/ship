/**
 * Plan fixtures shared by the demo seeds (DEMO-142, DEMO-143) and their
 * fixture test — the authored turn-envelope shape the plan node publishes:
 * clean plan markdown plus the meta object `planStore.persistPlan` writes
 * into `artifacts.meta` (`{ feedback, steps, branches, execution,
 * executionSource, execution_rationale }` — only the fields a demo story
 * needs). No markdown plan-meta fence in the markdown: the parser never reads
 * the markdown, it reads the artifact's JSONB meta column.
 *
 * Plain data module (no imports, no side effects) so both the seeds and
 * `tests/demoSeedPlanFixtures.test.ts` can consume it — the seed scripts
 * themselves must never be imported (they run on import).
 */

/** DEMO-142 plan v1 — first draft, 2 branches (backend, worker), 7 steps. */
export const DEMO_FLOW_PLAN_V1 = {
  markdown: `# Webhook retry pipeline — implementation plan (v1)

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
`,
  meta: {
    feedback: null,
    steps: [
      {
        id: "s1",
        title: "Create webhook_events outbox table",
        detail:
          "Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.",
        files: ["db/migrations/014_webhook_events.sql"],
        branch: "backend",
      },
      {
        id: "s2",
        title: "Outbox writer + state machine",
        detail:
          "persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.",
        files: ["lib/webhooks/outbox.ts"],
        branch: "backend",
      },
      {
        id: "s3",
        title: "Exponential backoff schedule",
        detail: "1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.",
        files: ["lib/webhooks/backoff.ts"],
        branch: "backend",
      },
      {
        id: "s4",
        title: "Delivery executor",
        detail:
          "POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.",
        files: ["lib/webhooks/deliver.ts"],
        branch: "backend",
      },
      {
        id: "s5",
        title: "Retry worker loop",
        detail:
          "Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.",
        files: ["workers/webhook-retry.ts"],
        branch: "worker",
      },
      {
        id: "s6",
        title: "Publish path via outbox",
        detail: "app/api/webhooks/route.ts writes to the outbox instead of firing directly.",
        files: ["app/api/webhooks/route.ts"],
        branch: "backend",
      },
      {
        id: "s7",
        title: "Admin replay endpoint",
        detail: "POST /admin/webhooks/:id/replay resets a dead event to pending.",
        files: ["app/api/admin/webhooks/[id]/replay/route.ts"],
        branch: "worker",
      },
    ],
    branches: [
      {
        name: "backend",
        title: "Outbox, backoff & delivery core",
        scope: "Schema, outbox writer, backoff, delivery executor, publish-path rewiring",
        files: [
          "db/migrations/014_webhook_events.sql",
          "lib/webhooks/outbox.ts",
          "lib/webhooks/backoff.ts",
          "lib/webhooks/deliver.ts",
          "app/api/webhooks/route.ts",
        ],
        steps: ["s1", "s2", "s3", "s4", "s6"],
        dependsOn: [],
      },
      {
        name: "worker",
        title: "Retry worker + admin replay",
        scope: "Background retry loop and the admin replay endpoint",
        files: ["workers/webhook-retry.ts", "app/api/admin/webhooks/[id]/replay/route.ts"],
        steps: ["s5", "s7"],
        dependsOn: ["backend"],
      },
    ],
  },
};

/**
 * DEMO-142 plan v2 — refined (single branch, s6 reworded → s9, s8 tests added).
 * `branches` is intentionally absent (a branchless plan) — the same shape
 * `persistPlan` writes for a plan the planner delivered without branches.
 */
export const DEMO_FLOW_PLAN_V2 = {
  markdown: `# Webhook retry pipeline — implementation plan (v2)

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
`,
  meta: {
    feedback: "single branch + tests step",
    steps: [
      {
        id: "s1",
        title: "Create webhook_events outbox table",
        detail:
          "Migration 014: id, payload, status, attempts, next_attempt_at, last_error, created/updated.",
        files: ["db/migrations/014_webhook_events.sql"],
        branch: null,
      },
      {
        id: "s2",
        title: "Outbox writer + state machine",
        detail:
          "persist() before delivery; transitions pending→delivered|retrying|dead with attempt counting.",
        files: ["lib/webhooks/outbox.ts"],
        branch: null,
      },
      {
        id: "s3",
        title: "Exponential backoff schedule",
        detail: "1m/5m/30m/2h/6h with ±20% jitter; pure function, unit-testable.",
        files: ["lib/webhooks/backoff.ts"],
        branch: null,
      },
      {
        id: "s4",
        title: "Delivery executor",
        detail:
          "POST the payload, record attempt before delivery, classify 2xx vs retryable vs dead.",
        files: ["lib/webhooks/deliver.ts"],
        branch: null,
      },
      {
        id: "s5",
        title: "Retry worker loop",
        detail:
          "Poll due events (status, next_attempt_at), deliver, reschedule or dead-letter. Crash-safe.",
        files: ["workers/webhook-retry.ts"],
        branch: null,
      },
      {
        id: "s9",
        title: "Rewire publish path through the outbox",
        detail:
          "app/api/webhooks/route.ts persists to the outbox and returns 202; the worker does delivery.",
        files: ["app/api/webhooks/route.ts"],
        branch: null,
      },
      {
        id: "s7",
        title: "Admin replay endpoint",
        detail: "POST /admin/webhooks/:id/replay resets a dead event to pending; rejects non-dead.",
        files: ["app/api/admin/webhooks/[id]/replay/route.ts"],
        branch: null,
      },
      {
        id: "s8",
        title: "Test suite: backoff, state machine, crash recovery",
        detail:
          "Unit + integration coverage for every acceptance criterion, incl. kill-worker-mid-retry.",
        files: ["lib/webhooks/__tests__/"],
        branch: null,
      },
    ],
  },
};

/**
 * DEMO-143 plan — approved and published with `execution: "steps"` (knob
 * resolution): the legitimate published value that drives the build node's
 * fan-out runtime (one child flow per plan step).
 */
export const FANOUT_PLAN = {
  markdown: `# Saved dashboard views — implementation plan

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
`,
  meta: {
    execution: "steps",
    executionSource: "knob",
    steps: [
      {
        id: "s1",
        title: "Saved views table + migration",
        detail: "Migration 031: id, owner_id, name, filters JSON, shared, pinned, created/updated.",
        files: ["db/migrations/031_saved_views.sql"],
      },
      {
        id: "s2",
        title: "View store CRUD + visibility",
        detail:
          "create/list/update/delete, share toggle, pin single-default invariant enforced in lib/views/store.ts.",
        files: ["lib/views/store.ts"],
      },
      {
        id: "s3",
        title: "Filter encode/decode",
        detail:
          "lib/views/filters.ts: canonical ⇄ URL query string ⇄ row payload round-trips; unknown params degrade gracefully.",
        files: ["lib/views/filters.ts"],
      },
      {
        id: "s4",
        title: "Views API routes",
        detail:
          "app/api/views + [id]: validation, ownership checks, sharing ACL, 404 vs 403 semantics.",
        files: ["app/api/views/route.ts", "app/api/views/[id]/route.ts"],
      },
      {
        id: "s5",
        title: "Dashboard ViewBar UI",
        detail:
          "app/dashboard/ViewBar.tsx: picker, apply, save (name dialog), pin control; wired to the filter bar state.",
        files: ["app/dashboard/ViewBar.tsx"],
      },
      {
        id: "s6",
        title: "Tests: store, filters, routes",
        detail: "Unit coverage for CRUD + encode/decode round-trips, route ACL tests.",
        files: ["__tests__/views/"],
      },
    ],
    branches: [],
  },
};
