# Step 03 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; all step-00
markers for this step flipped).

## What landed

- **Schema** (`20261118173302_step03_durable_waits_leases_jobs`):
  `nodes.wait_until` / `nodes.lease_until`, `runs.attempt_id` /
  `runs.lease_until`, the `jobs` table + `job_kind` / `job_status` enums.
  Authored with `prisma migrate diff` (the dev DB user cannot create the
  shadow database `prisma migrate dev` needs).
- **Authority lease semantics**: `claim` clears `wait_until` and stamps
  `lease_until = now() + NODE_LEASE_SECONDS` (DB time); every non-claim
  transition clears `lease_until` (and `wait_until` unless the transition
  arms one — `armWait` patches it in the same statement).
- **WaitStore** (`runtime/waits/`) replaces `waitScheduler.ts` outright: no
  timer map, no `reArmWaitingTimers` heuristic. The step-00 stranding bug's
  real cause was the DOUBLE claim (`fire` pre-claimed, then
  `startNodeStage`'s own `resumeWait` claim conflicted and silently
  returned) — fixed by making `startNodeStage` the single claim+fire owner;
  the store only guards, announces, and hands over.
- **Leases**: agent stream loop heartbeats node + run leases
  (`NodeSupport.heartbeatLeases`); the pipeline gate's wait loop and the
  worktree-ensure path (`WorktreeManager.touchNode`) extend the node lease.
  `registerStartupRun`/`persistRun` stamp run attempt + lease.
  `START_GRACE_MS` / `PIPELINE_STAMP_FRESH_MS` / `Reconciler.THROTTLE_MS`
  and the attempt-registry liveness role (`flowEngine.activeAttempt`) are
  gone.
- **Reconciler v2** (`runtime/reconcile/`): thin walker + per-status
  handlers (`RunningHandler`, `WaitingHandler`, `AwaitingApprovalHandler`,
  `ApprovedHandler`) + `RecoveryDriver` (interim ABI — full result-object
  ABI is step 05) + `StepMergeRecovery` (ported fan-out family recovery,
  own `STEP_MERGE_GRACE_MS` freshness for the merge arena, which has no
  lease column). Reconcile now also runs on flow open
  (`loaders/flows.ts` → `getFlowCockpitData`).
- **JobQueue** (`runtime/jobs/`): write-ahead enqueue with `dedup_key`,
  `SKIP LOCKED` claims, lease expiry re-claim, attempts→failed with a typed
  event. The hooks route and the GitLab route journal deliveries through it
  (`X-Gitlab-Event-UUID` dedup); the old `hook_deliveries` dedup methods
  were removed from `HookStore` (the table stays — seed/migration scripts
  reference it).
- **Schedule fires**: the poller only ENQUEUES (`template:<id>:<fireAt>`);
  `ScheduleFireHandler` fires, then advances `schedule_next_at` and marks
  the job done in ONE transaction — the old advance-then-fire order's
  crash window (silently dropped fire) is gone.
- **ProcessLock** (`runtime/locks/`): `pg_try_advisory_lock` on a dedicated
  `pg` connection (Prisma's pool cannot hold a session lock). Poller ticks
  refuse to run without it. `GET /api/health` reports
  `{ writer, since }` from `pg_locks` (shared truth across processes).
- **Worker process** (decision Q10): `worker/main.ts` + `npm run worker`
  (new devDependency `tsx`, approved — resolves the `@/` path aliases;
  `server-only` stubbed via `worker/tsconfig.json` paths). Loads `.env` via
  `@next/env` like the Next wrappers. `instrumentation.ts`,
  `instrumentation.node.mjs`, the `db` lazy background-workers side effect,
  and the `flowPoller`/`reconciler`/`hookStore`/localApi-token
  `processSingleton` exports are deleted; arch-test allowlists shrank
  accordingly. GitLab webhook startup warnings moved to
  `config.gitlab.logStartupWarnings()` (worker boot + first webhook-route
  use).

## Design calls worth knowing

- **Fan-out/split aggregates** park `running` for the duration of child
  flows with no heartbeat loop. `RunningHandler` treats durable evidence —
  active child flows, or a fresh in-flight `step_merges` row — as liveness
  before recovering; a plain lease check alone would fail every live
  aggregate.
- **ApprovedHandler scope**: only MR-producing nodes (`chainRole` BUILD).
  Plan nodes and branch-choice nodes also rest in `approved` legitimately;
  reverting those would break live flows. The adopt/recreate MR path lands
  with the step-07 effect layer; today the handler reverts via
  `mrHandback`.
- **Exactly-once webhook resume**: the resume path's own node claim (via
  the authority) dedups the crash re-dispatch — a re-claimed job whose node
  already left `waiting` completes silently. Template starts are
  at-least-once (a crash after flow creation re-creates); the dedup key
  stops the common retry path.
- **Wait fires** go through `WaitStore.sweepDueWaits` (claim + fire in
  `startNodeStage`), driven by the poller tick and the reconciler's
  WaitingHandler. The `wait_fire` / `merge_back` job kinds are authored in
  the enum per target-architecture §3 but carry no dispatchers yet
  (`merge_back` is the step-07 merge-back coordinator's).
- **Test coverage note**: `StepMergeRecovery` is byte-ported legacy logic
  (fan-out family recovery) exercised indirectly by every `reconcileFlow`
  test; its dedicated coverage rides with the step-07 fan-out work that
  owns that domain. `ScheduleFireHandler`, `WebhookDeliveryHandler`,
  `JobQueue`, `ProcessLock`, `WaitStore`, `Reconciler` and the handlers all
  have direct tests.

## Deviations / flags for review

- **docker-compose worker service**: not added. The compose file contains
  only Postgres — there is no app image/Dockerfile to run a worker service
  from, so a service would be dead config. README documents the two-terminal
  dev flow instead; revisit when the app gets a container build.
- **`AGENT` files**: `AGENTS.md` §3.3 (dev-singleton wording) and
  `docs/coding-patterns.md` §3.8 (process state) still describe the
  pre-worker model — step 09 is the docs/consistency pass that rewrites
  them (per the overhaul README's step table).
- `nodes.updated_at` remains a display/bookkeeping column (worktree dir
  persistence, run-row bookkeeping) — it just no longer carries any
  correctness/liveness meaning.
