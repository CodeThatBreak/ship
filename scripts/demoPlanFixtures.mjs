/**
 * Plan fixtures shared by the demo seed (DEMO-142) and its fixture test —
 * the authored turn-envelope shape the plan node publishes: clean plan
 * markdown plus the meta object `planStore.persistPlan` writes into
 * `artifacts.meta` (`{ feedback, steps }` — only the fields a demo story
 * needs). No markdown plan-meta fence in the markdown: the parser never
 * reads the markdown, it reads the artifact's JSONB meta column.
 *
 * Plain data module (no imports, no side effects) so both the seeds and
 * `tests/demoSeedPlanFixtures.test.ts` can consume it — the seed scripts
 * themselves must never be imported (they run on import).
 */

/** DEMO-142 plan v1 — first draft, 7 steps. */
export const DEMO_FLOW_PLAN_V1 = {
  markdown: `# Webhook retry pipeline — implementation plan (v1)

## Approach
Add a durable outbox table, a retry scheduler, and an admin replay endpoint.

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
        id: "s6",
        title: "Publish path via outbox",
        detail: "app/api/webhooks/route.ts writes to the outbox instead of firing directly.",
        files: ["app/api/webhooks/route.ts"],
        branch: null,
      },
      {
        id: "s7",
        title: "Admin replay endpoint",
        detail: "POST /admin/webhooks/:id/replay resets a dead event to pending.",
        files: ["app/api/admin/webhooks/[id]/replay/route.ts"],
        branch: null,
      },
    ],
  },
};

/**
 * DEMO-142 plan v2 — refined (s6 reworded → s9, s8 tests added).
 * The same meta shape `persistPlan` writes for every plan.
 */
export const DEMO_FLOW_PLAN_V2 = {
  markdown: `# Webhook retry pipeline — implementation plan (v2)

> Refined from feedback: *"The pieces are tightly coupled — keep them in one
> cohesive change. And the acceptance criteria require tests, add a step."*

## Approach
Same design as v1, delivered as one cohesive change: durable outbox → backoff →
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
    feedback: "cohesive change + tests step",
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
