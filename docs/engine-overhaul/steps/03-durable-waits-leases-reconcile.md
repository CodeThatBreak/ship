# Step 03 — Durable waits, leases, reconcile-all, job queue

## Goal

Invariants 2 and 3: **durable, origin-agnostic state** and a reconciler that walks
**every** non-terminal state. Wait deadlines, run/node leases, and job
(webhook/schedule) claims live in Postgres; in-memory maps become caches at most.
The `updated_at`-as-heartbeat trick dies. Single-writer is enforced by a Postgres
advisory lock (decision Q1's single-writer default), turning the "keep one server
running" runbook line into code.

## Depends on

Step 02 (all status writes go through the authority; the reconciler and wait firing
must use it). Step 01 (new columns + `SKIP LOCKED` need Postgres).

## Files affected

- Prisma migration: `nodes.wait_until`, `nodes.lease_until`, `runs.lease_until`,
  `runs.attempt_id`; new `jobs` table (see `target-architecture.md` §3).
- New: `lib/engine/runtime/waitStore.ts` (durable waits; replaces
  `WaitScheduler.waitTimers`), `lib/engine/runtime/jobQueue.ts` (enqueue/claim/
  complete/fail with lease + attempts), `lib/engine/runtime/processLock.ts`
  (`pg_advisory_lock` held on a dedicated connection for process lifetime).
- Rewrite: `lib/engine/runtime/waitScheduler.ts` → thin facade over `waitStore`
  (arm/bounce/fire; re-arm heuristics deleted), `lib/engine/runtime/flowReconciler.ts`
  → Reconciler v2 (matrix below), `lib/engine/runtime/flowPoller.ts` (ticks driven
  by `wait_until` + job claims; schedule sweep enqueues jobs).
- Edit: `app/api/hooks/[id]/route.ts` (write-ahead job insert, claim, dispatch, mark
  done — replaces mark-after-dispatch), `app/api/webhooks/gitlab/route.ts` (dedup
  via job `dedupKey` from `X-Gitlab-Event-UUID`).
- Edit: `pipelineNode.ts` (heartbeat moves to `nodes.lease_until`, L548-551),
  `worktreeLifecycle.ts` (`touchNode` L90-93 → lease touch or delete),
  `flowEngine.ts` (`reArmWaitingTimers` deleted; cancel clears leases),
  `nodeSupport.ts` (`registerStartupRun`/`persistRun` write lease + attempt).
- Edit: `commentIngestor.ts`, `flowPoller.ts` — poller/reconciler run only when
  `ProcessLock` is held; a non-holder logs once and exposes lock state on a health
  route.
- New: `worker/main.ts` (+ npm script, docker-compose service).
- Delete: `instrumentation.ts`, `instrumentation.node.mjs`, the
  "background-workers" side effect in `lib/db/app.ts`.
- Tests: flip markers from step 00 (`waitResume`, `reconcileStates`, restart cases).

## Concrete tasks

1. `waitStore`: arm = `UPDATE nodes SET status='waiting', wait_until=?` via the
   authority; sweep = claim due rows
   (`UPDATE … SET status='running', attempt_id=? WHERE status='waiting' AND wait_until <= now()`)
   then fire. Debounce bounce = update `wait_until`. `resolveScheduleLabel` reads
   `wait_until` from the row (UI keeps working).
2. Leases: `startNodeStage` sets `nodes.lease_until`; the pipeline wait loop and
   agent stream loops heartbeat by extending the lease (explicit interval
   constant); terminal transitions clear it. Reconciler liveness =
   `lease_until > now()`, not timestamp freshness windows — delete
   `START_GRACE_MS`/`PIPELINE_STAMP_FRESH_MS` heuristics and the per-process
   `nodeAttemptRegistry` liveness role (registry may stay as a cache, never the
   truth). Delete `Reconciler.THROTTLE_MS` too — the v2 pass is idempotent and
   cheap (lease comparisons in SQL), so the 20s per-flow throttle that let a
   crashed flow sit visibly stuck goes; the pass runs every worker tick and on
   flow open.
3. `jobQueue`: kinds `webhook_delivery | schedule_fire | wait_fire | merge_back`;
   `dedupKey` unique (`hook:webhookId`, `template:fireAt`); claim =
   `UPDATE jobs SET status='claimed', lease_until=?, attempts=attempts+1
    WHERE id=? AND status='queued' RETURNING`;
   failure ⇒ requeue with backoff until `attempts >= MAX` ⇒ `failed` + typed event
   (kills the "GitLab retries forever" path). Startup sweep reclaims expired
   `claimed` leases.
4. Webhook routes: insert job (write-ahead, `skipDuplicates` on `dedupKey`) → claim
   → dispatch → mark done. Crash between dispatch and done ⇒ lease expiry ⇒
   re-claim; the resume claim itself dedups the side effect. GitLab route gains the
   same dedup via `X-Gitlab-Event-UUID`.
5. Schedule fires: sweep enqueues due templates idempotently; fire marks done and
   advances `schedule_next_at` in the **same** transaction as job completion — a
   crash no longer silently drops a fire (today it advances first,
   `flowPoller.ts:161-166`).
6. Reconciler v2 (idempotent, the `target-architecture.md` §8 matrix):
   `running` + expired lease → RecoveryDriver (full ABI lands in step 05; interim:
   try node's `recover`, fail `manual`); `waiting` + past `wait_until` → enqueue
   `wait_fire`; `waiting`/`awaiting_approval` + dead upstream → `failed` + event;
   `approved` build + no MR → adopt/recreate via `MergeRequestService` or revert to
   `awaiting_approval` + event.
7. `ProcessLock`: `pg_try_advisory_lock` at boot on a dedicated connection;
   poller/reconciler/job-sweep refuse to run without it; `/api/health` exposes
   `{ writer: boolean, since }`. Document: a second server boots read-safe but
   never writes schedules/reconciles.
8. Worker process (Q9 + Q10): all time-driven work moves to a dedicated process:
   - New: `worker/main.ts` — builds the process container, acquires
     `ProcessLock` (idempotent: a second worker doesn't acquire and idles with a
     log), starts the poller, reconciler loop and job sweeps. `npm run worker`;
     README documents running it alongside `npm run dev` (two terminals); the
     docker-compose file gains a `worker` service. The worker is Node-only and
     lives outside the Next bundle (plain `tsx`/`node` entry, no `server-only`
     import — that marker exists to keep `lib/` out of *client* bundles, and the
     worker never shares a bundle with client code; it imports the same `lib/`
     modules directly).
   - Delete: `instrumentation.ts`, `instrumentation.node.mjs`, and the lazy
     "background-workers" side effect in `lib/db/app.ts`. The web process is
     pure request/response — user-initiated actions (approve, retry, run, chat)
     claim synchronously in-request through the same DB-fenced paths, so the UI
     never depends on the worker.
   - Relocate the deleted file's real duties: local-API token bootstrap → lazy
     initializer in `lib/localApi/token.ts` (minus `processSingleton`);
     webhook-config warnings → `lib/config.ts` validation, logged by web and
     worker on first use.
   - Remove the `flowPoller`/`reconciler`/`hookStore`/`background-workers`
     `processSingleton` exports; shrink the arch-test allowlist.
   - **Verify**: worker-side reconciler handles runs owned by the web process —
     liveness is lease + SDK persisted store (`Agent.getRun`), never handles;
     cancel/status from the web process works when the run lives web-side.
9. Module design (quality bar): `WaitStore` replaces `waitScheduler.ts` outright;
   `Reconciler` is built decomposed — one handler class per non-terminal state
   (`RunningHandler`, `WaitingHandler`, `AwaitingApprovalHandler`,
   `ApprovedHandler`) behind a thin `Reconciler` walker, each with header doc +
   co-located test, under `lib/engine/runtime/reconcile/` per the §12 layout.
   `JobQueue` and `ProcessLock` land in `runtime/jobs/` and `runtime/locks/`.
   Purity rule applies: job kinds/status vocabulary in `jobs/constants/`, job row
   and handler types in `jobs/types/` + `reconcile/types/`, backoff/timeout
   constants in named `constants/` files — nothing module-scope in class files.

## Libraries used

None new (Postgres advisory locks + `SKIP LOCKED` are server features).

## Risks

- **Claim-then-fire ordering** is the original resume bug — the durable sweep claims
  and fires in one owner (`waitStore.fire`), covered by the step-00 resume tests
  flipping green. Do not split claim and fire across modules again.
- **Clock skew** in lease comparisons: use DB-server time (`now()`) in SQL, never
  app-server `Date.now()`, for lease writes and sweeps.
- **Job retry storms**: backoff + `MAX_ATTEMPTS` + a loud `failed` event; the
  schedule-fire job must not retry an already-advanced schedule (transaction in
  task 5).
- **Advisory lock held on a pooled connection**: pin one dedicated client/connection
  for the lock; document why Prisma's pool can't hold it.
- Two-phase behavior during rollout (old rows with no lease): treat missing lease
  on `running` as expired (fail loud) — no legacy backfill shims (AGENTS §4.6).

## Acceptance criteria / tests

- Flip green: `waitResume.test.ts` (webhook + timer + **restart** case — the
  restart test loses its `test.skip`), `reconcileStates.test.ts`
  (approved-no-MR, expired-waiting, dead-upstream).
- New: `jobQueue.test.ts` (claim exclusivity under two concurrent claimers, lease
  expiry re-claim, attempts→failed), `processLock.test.ts` (non-holder doesn't
  tick), webhook crash-window test (kill between dispatch and done ⇒ exactly-once
  effect).
- `rg "updated_at" lib/engine/runtime/pipelineNode.ts worktreeLifecycle.ts` shows no
  heartbeat writes; `START_GRACE_MS`/`PIPELINE_STAMP_FRESH_MS` gone.
- `npm run check` + build green.
