# Raw SQL → Prisma ORM migration plan

Migrate the remaining raw SQL (`$queryRaw*`, `$executeRaw*`, `db.get/all/run`, `rows.get/all` with hand-written SQL strings) to the Prisma ORM query API, for type safety and readability. Closes decision Q1's "ORM-first" requirement.

**Status: DONE (Task 12, 2026-11-21).** All 12 tasks landed; `lib/db/database.ts` no longer has generic raw-query helpers (`db.get/all/run`, `rowsFor`) and new raw SQL outside the containment list below fails `tests/architecture/noRawSqlOutsideContainment.test.ts` and the lib-scoped ESLint rule.

## Current state (verified 2026-11-20)

- **132 raw-SQL call sites** in **31 non-test files** under `lib/` (plus test doubles in `tests/` and `*.test.ts`).
- `app/` is already clean (0 raw call sites).
- All raw access flows through three choke points:
  1. `Database.get/all/run` (`lib/db/database.ts`) — `$queryRawUnsafe`/`$executeRawUnsafe` wrappers.
  2. `RowGateway.get/all` (`lib/db/rows.ts`) — zod-validated rows over hand-written SQL with camelCase aliases.
  3. `executorFor` (`lib/engine/runtime/transitions/utils/executor.ts`) — tx-aware `run/get/all` used by the transition authority.

## Hard constraints (read first)

1. **No schema changes in this migration.** `prisma/schema.prisma` already models all 23 tables with `@map` snake_case. If a query seems to need a schema change (missing relation, missing index), stop and ask (AGENTS §1).
2. **Invariant-critical SQL stays raw — but contained.** Some statements are correctness primitives that Prisma cannot express. These keep raw SQL, moved behind a named method with a comment citing the invariant; they are *not* migrated to ORM calls (see "Stays raw" below).
3. **JSONB payloads stay zod-validated at the boundary** (AGENTS §1: schema changes coordinate with `lib/db/rows.ts` validators). Prisma returns `Prisma.JsonValue`; mappers still narrow to the typed payload shapes from `lib/db/rows.ts`.
4. **Every multi-row write remains one `$transaction`**; async I/O stays outside the callback (AGENTS §3.2).
5. **Follow the transition-authority invariant.** `tests/architecture/noRawNodeStatusWrite.test.ts` already forbids raw `nodes.status`/`attempt_id` writes outside the authority — migrations must not add new writers.
6. **One PR per task below.** Each task is independently mergeable; DoD (`npm run check` + `npm run build`) must pass on each.

## Containment record (final — verified by Task 12's scan)

These are the ONLY raw-SQL sites left in `lib/` (enforced by `tests/architecture/noRawSqlOutsideContainment.test.ts` and the lib-scoped `no-restricted-syntax` ESLint rule; the shared allowlist constant lives in `eslint/rawSqlContainment.mjs`). Each is a Postgres feature Prisma's query API cannot express, isolated behind a named method:

| Site | Reason it stays raw |
| --- | --- |
| `jobQueue` claims + `requeueWithBackoff` + `failExhausted` | `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` — atomic claim with the lease stamp (`make_interval`) in the same statement; `failExhausted` compares `lease_until` to DB `now()` and needs `UPDATE … RETURNING` to emit events atomically. |
| `nodeSupport.stampNodeLease/stampRunLease` | `lease_until = now() + make_interval(secs => $n)` — lease liveness on the DB-server clock (step 03, Invariant 2). |
| `nodeTransitions` (one named method per transition kind) | Attempt-fenced CAS (step 06, Invariants 7/11) — conditional `UPDATE … WHERE attempt_id = current [AND NOT EXISTS …] RETURNING`, the single-writer primitive. |
| `processLock` | `pg_try_advisory_lock`/`pg_advisory_unlock` on a dedicated `pg` client — session-scoped lock cannot ride Prisma's pool. |
| `writerLockStatus` | `pg_locks` catalog read — cross-process lock visibility. |
| `runningHandler` staleness window | `updated_at > now() - make_interval(…)` (mergeInFlight) — interval arithmetic on DB time. |
| `recoveryDriver.latestRunLeaseState` | `lease_until > now()` compared on the DB clock in the SELECT projection. |
| `reconciler.reconcileNodeStates` | `leaseExpired`/`waitDue` flags computed from `lease_until`/`wait_until` against `now()` on the DB clock. |
| `approvedHandler.hasLiveMrCreateJob` | Live-lease probe (`lease_until > now()`) inside the job-status filter. |
| `worktreeActivity.stampNodeLease` | Warm-up lease heartbeat: `make_interval` on DB time, guarded by `flow_id`. |
| `waitStore.dueWaitingNodes` / `deferDebounceWait` | `wait_until <= now()` due-ness on the DB clock; `make_interval` debounce. |
| `usageTracker.persistUsage` | Column-wise `COALESCE` partial update — one UPDATE that overwrites only provided columns; no Prisma equivalent. |

**Dropped from the earlier draft list:** `lib/db/templateSeeder.ts` — Task 06 converted it fully to `createMany({ skipDuplicates: true })` / `upsert` with zero raw SQL remaining (verified by grep and by the scan's per-entry presence check), so it is NOT allowlisted.

Rule of thumb (unchanged): **conditional updates with row-existence subselects, `SKIP LOCKED`, interval arithmetic, advisory locks, `pg_*` catalogs, and DB-clock-computed flags stay raw. Plain CRUD, filtered selects, joins-as-separate-queries, `IN` filters, and `ON CONFLICT` upserts are ORM.**

### Verified behavior notes (orchestrator, across Tasks 01–11)

- **RowGateway corrupt-row semantics:** reads now zod-narrow with `RowDecodeError` raised on `get` and skip+log on `list` (RowGateway parity with the pre-migration behavior).
- **`jobs.updated_at` stamps** moved from DB `now()` to Prisma `@updatedAt` (app time) — no lease decision reads `updated_at` (only `run_at`/`lease_until`), so the clock-source change is behaviorally inert.
- **`commentService`** preserves blank-body behavior with `?? ""` (Prisma types `body` nullable; empty string was and is the stored shape for blank bodies).
- **Known style leftovers flagged for a future pass, NOT fixed:** `stepMergeRecovery` inline status literals; missing execution-mode constant for local/cloud; `FLOW_CHILD_TABLES` ↔ `deleteFlowChildRows` ordering guarded only by a comment.

## Migration strategy

For each converted site:

1. Replace the SQL string with a Prisma call on the injected client (`this.db.prisma.<model>`) or the tx client when inside `transaction(fn)`.
2. Keep the zod row validators from `lib/db/rows.ts` where the row crosses a trust boundary (JSONB payloads: `nodes.input/output`, `artifacts.meta`, event `data`, template `config/trigger/inputMap`). Scalar columns are now typed by Prisma — drop the redundant scalar checks, keep the payload narrowing.
3. Delete the camelCase `AS "alias"` lists — Prisma already surfaces camelCase fields via `@map`.
4. Where a `SELECT … JOIN` was emulated by N sequential raw queries (e.g. `flowReadModel`), either use Prisma `include` (when relations exist in the schema) or keep separate typed queries — do not build one mega-query for its own sake.
5. Update the file's tests: mock `prisma.<model>.<op>` instead of `db.run/get/all`. Test fixtures and test data are exempt from the constants rule (AGENTS §2.7) but must still typecheck.

---

## Workstreams (run in parallel — one PR per task)

Tasks are grouped so no two tasks touch the same file. Wave 1 has no inter-dependencies; land them in any order. Wave 2 finishes the choke points once consumers are gone.

### Wave 1 — independent service migrations (parallel)

| # | Task | Files (sole owner) | Raw sites | Effort | Depends on |
| --- | --- | --- | ---: | :---: | --- |
| 01 | [Template store → ORM](01-template-store.md) | `lib/engine/templates/templateStore/templateStore.ts`, `lib/engine/templates/templateLint.ts` | ~30 | L | — |
| 02 | [Flow read model → ORM](02-flow-read-model.md) | `lib/engine/runtime/flowReadModel.ts` | ~16 | M | — |
| 03 | [Node support + artifacts → ORM](03-node-support-artifacts.md) | `lib/engine/nodes/shared/nodeSupport.ts`, `lib/artifacts/artifactService.ts` | ~15 | M | — |
| 04 | [Hook store → ORM](04-hook-store.md) | `lib/engine/runtime/hookStore/hookStore.ts`, `lib/engine/runtime/hookStore/utils/firstHookRow.ts` | ~10 | S | — |
| 05 | [Fan-out stores → ORM](05-fanout-stores.md) | `lib/engine/runtime/fanout/{mergeArena,mergeBackCoordinator,stepChildStore,stepFlowExpander,stepRollup}.ts`, `lib/engine/runtime/fanout/stepFlowManager/stepFlowManager.ts` | ~12 | M | — |
| 06 | [Template seeder → createMany/upsert](06-template-seeder.md) | `lib/db/templateSeeder.ts` | ~15 | M | — |
| 07 | [Flow services → ORM](07-flow-services.md) | `lib/engine/flow/{flowApprovalService,flowManualRunService,flowPlanStepService,flowRetryService}.ts`, `lib/engine/flowEngine/flowEngine.ts` (raw parts only), `lib/engine/harness/utils/markEstimated.ts` | ~10 | M | — |
| 08 | [Graph/task/prompt-preview/resolve → ORM](08-misc-read-services.md) | `lib/engine/graph/graphService/graphService.ts`, `lib/engine/tasks/taskService/taskService.ts`, `lib/engine/prompts/promptPreview/promptPreview.ts`, `lib/engine/nodes/kinds/resolve/utils/planResolveEffects.ts`, `lib/engine/runtime/worktreeLifecycle/worktreeActivity.ts`, `lib/engine/runtime/flowFactory.ts` | ~14 | M | — |
| 09 | [Jobs + reconcile: isolate the raw claims](09-jobs-isolate-raw.md) | `lib/engine/runtime/jobs/{jobQueue,cancelHandler}.ts`, `lib/engine/runtime/reconcile/{recoveryDriver,approvedHandler,runningHandler}.ts` | ~12 | M | — |
| 10 | [Waits + transitions executor containment](10-transitions-containment.md) | `lib/engine/runtime/waits/waitStore.ts`, `lib/engine/runtime/transitions/nodeTransitions.ts`, `lib/engine/runtime/transitions/utils/executor.ts` | ~12 | M | — |

### Wave 2 — choke-point cleanup (sequential, after Wave 1)

| # | Task | Files | Effort | Depends on |
| --- | --- | --- | :---: | --- |
| 11 | [Delete `db.get/all/run` and `rowsFor`; shrink `RowGateway`](11-choke-point-cleanup.md) | `lib/db/database.ts`, `lib/db/rows.ts`, `lib/db/rowGatewayAccess.ts`, remaining importers | M | 01–10 |
| 12 | [Lint ratchet + docs: ban new raw SQL outside the containment list](12-lint-and-docs.md) | `eslint.config.*`, `tests/architecture/`, `docs/coding-patterns.md`, `AGENTS.md` | S | 11 |

## Definition of done (per task)

- [ ] `npm run check` and `npm run build` pass.
- [ ] No raw SQL added; converted sites use the injected Prisma/tx client.
- [ ] JSONB boundaries still validated with the existing zod schemas.
- [ ] Tests updated to mock Prisma calls; no test logic changed beyond the mock seam.
- [ ] Raw sites on the containment list are untouched (or tightened behind a named method).
- [ ] `docs/orm-migration/<task>.md` ticked; any discovered violation outside scope flagged in the PR description (AGENTS §2.10), not silently fixed.

## Progress

| Done | # | Task |
| :---: | --- | --- |
| [x] | 01 | Template store → ORM |
| [x] | 02 | Flow read model → ORM |
| [x] | 03 | Node support + artifacts → ORM |
| [x] | 04 | Hook store → ORM |
| [x] | 05 | Fan-out stores → ORM |
| [x] | 06 | Template seeder → createMany/upsert |
| [x] | 07 | Flow services → ORM |
| [x] | 08 | Misc read services → ORM |
| [x] | 09 | Jobs + reconcile: isolate raw claims |
| [x] | 10 | Waits + transitions containment |
| [x] | 11 | Choke-point cleanup |
| [x] | 12 | Lint ratchet + docs |
