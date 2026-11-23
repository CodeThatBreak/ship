/**
 * Raw-SQL containment allowlist (orm-migration Task 12) — the ONLY places in
 * `lib/` where raw SQL may exist, each justified by a Postgres invariant the
 * Prisma query API cannot express. Single source of truth shared by:
 * - the ESLint ratchet (`eslint.config.mjs` — `ignores` + `no-restricted-syntax`)
 * - the architecture scan (`tests/architecture/noRawSqlOutsideContainment.test.ts`)
 *
 * ORM-first rule (AGENTS.md §0): new persistence goes through the Prisma ORM
 * query API. A raw statement anywhere else fails both gates. See
 * docs/orm-migration/README.md ("Containment record") for the full rationale.
 */
export const RAW_SQL_CONTAINMENT = [
  // SKIP LOCKED atomic claims (`claimNext`/`claimById`/`reclaimExpired`:
  // UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)) plus
  // `requeueWithBackoff` (run_at interval arithmetic on DB time) and
  // `failExhausted` (lease_until compared to DB now() + UPDATE…RETURNING in
  // one atomic statement) — no Prisma equivalent for claim-and-stamp-lease
  // in a single statement.
  "lib/engine/runtime/jobs/jobQueue.ts",
  // Lease stamps (`stampNodeLease`/`stampRunLease`): `lease_until = now() +
  // make_interval(secs => $n)` — interval arithmetic on the DB-server clock
  // (liveness invariant, engine overhaul step 03).
  "lib/engine/nodes/shared/nodeSupport.ts",
  // Attempt-fenced CAS (Invariants 7/11): one named method per transition
  // kind, each a conditional UPDATE … WHERE attempt_id = current [AND NOT
  // EXISTS …] RETURNING — the transition authority's single-writer primitive.
  "lib/engine/runtime/transitions/nodeTransitions.ts",
  // Advisory-lock intrinsics: `pg_try_advisory_lock`/`pg_advisory_unlock` on
  // a dedicated pg client (session-scoped lock cannot ride Prisma's pool).
  "lib/engine/runtime/locks/processLock.ts",
  // `pg_locks` catalog read — cross-process lock visibility for the health route.
  "lib/engine/runtime/locks/utils/writerLockStatus.ts",
  // `latestRunLeaseState`: `lease_until > now()` compared on the DB clock in
  // the SELECT projection — a cross-server-clock race decision.
  "lib/engine/runtime/reconcile/recoveryDriver.ts",
  // `reconcileNodeStates`: leaseExpired/waitDue flags computed from
  // `lease_until`/`wait_until` against `now()` on the DB clock in one SELECT.
  "lib/engine/runtime/reconcile/reconciler.ts",
  // `hasLiveMrCreateJob`: live-lease probe (`lease_until > now()`) inside the
  // job-status filter — DB-clock comparison.
  "lib/engine/runtime/reconcile/approvedHandler.ts",
  // Warm-up lease heartbeat (`stampNodeLease`: `make_interval` on DB time,
  // guarded by flow_id so a stale node id cannot stamp a foreign flow's row).
  "lib/engine/runtime/worktreeLifecycle/worktreeActivity.ts",
  // `dueWaitingNodes` (`wait_until <= now()` on the DB clock — due-ness is a
  // DB-clock decision) and `deferDebounceWait` (`make_interval`).
  "lib/engine/runtime/waits/waitStore.ts",
  // `persistUsage`: column-wise COALESCE partial update — one UPDATE that
  // overwrites only the provided columns; no Prisma query-API equivalent.
  "lib/engine/harness/usageTracker/usageTracker.ts",
];
