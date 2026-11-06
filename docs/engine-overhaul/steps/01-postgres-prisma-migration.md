# Step 01 — Postgres + Prisma migration

## Goal

Move persistence from better-sqlite3/TEXT-columns to Postgres + Prisma (decision Q1)
**with zero behavior change**, so every later step builds on typed rows, JSONB, real
enums and timestamps instead of building twice. All engine writes become async at
the persistence boundary. The step-00 suite (sanity green, characterization red)
must produce the identical pass/fail profile before and after.

## Depends on

Step 00 (the characterization suite is the safety net).

## Files affected

- New: `prisma/schema.prisma`, `prisma/migrations/`, `docker-compose.yml`
  (Postgres 16 + a test database), `scripts/migrate-sqlite-to-pg.mjs` (one-off data
  migration), `lib/db/prismaClient.ts` (PrismaClient via the `processSingleton`
  pattern).
- Rewrite: `lib/db/database.ts` (thin async wrapper: `query`, `transaction` →
  `prisma.$transaction`), every store in `lib/db/stores/` and
  `lib/engine/runtime/*Store.ts`, `lib/db/rows.ts` (shrinks to Zod validators for
  JSONB payloads only — Prisma generates column types).
- Edit (mechanical, wide): everything calling `db.get/all/run` synchronously —
  `flowEngine.ts`, `edgeActivator.ts`, `waitScheduler.ts`, `nodeStore.ts`,
  `nodeSupport.ts`, `sdlcChain.ts`, `stepFlowManager.ts`, `splitManager.ts`,
  `flowReconciler.ts`, `flowPoller.ts`, `hookStore.ts`, `mergeArena.ts`,
  `planStepStore.ts`, `templateStore.ts`, `commentStore.ts`, event stores, node
  kinds, routes, loaders. Host interfaces (`flowEngineHost.ts`) become async.
- Edit: `lib/config.ts` (`DATABASE_PATH` → `DATABASE_URL`; demo/prod separation via
  two databases), `lib/singleton.ts` (PrismaClient), seed scripts
  (`scripts/seed-*.mjs` → Prisma writes against the demo database).
- Delete (end of step): `better-sqlite3` import sites in `lib/`; keep the package
  one extra step for the migration script's reader, then remove.
- Edit: `tests/helpers/testDatabase.ts` — provision a fresh test schema/database per
  run (dockerized Postgres), truncate between test files.
- Edit: `AGENTS.md` §1/§3.3, `README.md` setup section, `docs/coding-patterns.md`
  §3.5 (transaction recipe, async), `docs/architecture/database.md`.

## Concrete tasks

1. Schema: port `lib/db/schema.sql` to Prisma — all 22 tables; JSONB for
   `input/output/config/meta/trigger_payload/usage/payload`; PG enums for
   `nodes.status`, `runs.status`, `flows.status` (add the undocumented `'skipped'`
   value), artifact status; `timestamptz` everywhere (drop TEXT ISO dates); keep
   `UNIQUE(flow_id, node_key)` and existing indexes; add `rows.ts`-documented
   constraints as `@db` types. `PRAGMA user_version` migrations replaced by
   `prisma migrate`. **Naming (Q11): every model field is declared camelCase with
   explicit `@map("snake_case")` for the column and `@@map` for the table** — the
   DB stays snake_case, all TypeScript reads `node.nodeKey` (note: Prisma does
   not auto-convert; the `@map` declarations are the convention, and a
   Prisma-schema arch test asserts it).
2. Client layer: `prismaClient.ts` singleton; `Database` becomes an async facade so
   call-site conversion is mechanical; `transaction(fn)` →
   `prisma.$transaction(async (tx) => …)` — async I/O stays outside the callback
   (same rule as before, now enforced by types).
3. Convert call sites. Watch for: `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
   (`createMany({ skipDuplicates: true })` or raw SQL); `changes` counts →
   `UPDATE … RETURNING` / `$executeRaw` result; `db.uid()` stays app-side;
   synchronous guard reads (`nodeStatus`) become `await` — ripple through
   `EdgeActivator`/`WaitScheduler` hosts, reconciler, poller, managers.
   **Naming (Q11):** the conversion is also the casing conversion — every read
   becomes camelCase (`node.nodeKey`, `flow.repoUrl`, `run.leaseUntil`); no
   snake_case variable survives in TypeScript. JSONB payload Zod schemas are
   rewritten with camelCase keys, and the data-migration script (task 4)
   camelCases the known typed payloads (node input/output, artifact meta, event
   data, trigger payloads) — flagged as a risk with a round-trip verification
   task; if a payload proves fragile, its keys stay as-is with a documented
   exception, never a silent mix.
4. Data migration script: read the sqlite file with better-sqlite3, write via
   Prisma in batched transactions, verify per-table row counts + spot-check JSONB
   payloads round-trip; idempotent (truncates target first, demo DBs only).
5. Dev/test infra: `docker-compose.yml` service `postgres` (dev) + `test` database;
   npm scripts `db:up`, `db:migrate`, `db:seed`, `db:test:setup`; vitest
   `globalSetup` points at the test database; per-file truncation helper in
   `tests/helpers/testDatabase.ts`.
6. Seeds: convert `scripts/seed-*.mjs` to Prisma against the **demo** database;
   keep the `--reset` safety guard (refuse unless target is the demo database URL).
7. Config/docs: `DATABASE_URL` in `.env.example`; README setup (`docker compose up`),
   AGENTS.md safety rules updated (seed scripts now target the demo Postgres DB);
   coding-patterns §3.5 rewritten for Prisma transactions.
8. Composition root scaffolding (decision Q9, lands incrementally through step 09):
   - `lib/db/prismaClient.ts` — the **only** surviving `processSingleton` (Prisma's
     connection pool, HMR-safe).
   - `lib/composition/container.ts` — `createContainer(prisma)` constructing stores
     via constructor injection; routes/loaders migrate to it as they are touched.
   - `tests/architecture/noProcessSingletonOutsideDb.test.ts` — `test.fails` with
     the 39-site inventory (gitRunner, worktrees, worktreeSetup, localGit,
     depPolicies, secretStore, modelCatalogService, commentService,
     settingsService, repoService, artifactService, statusService,
     contractService, cursorSdk, cursorClient, cursorCredentials, jira, gitLab,
     localAgent, localApi token, declarativeKindRegistry/declarativeDefCache,
     taskService, liveTaskFeed, nodeStore, reconciler, flowEngine, flowPoller,
     nodeAttemptRegistry, stepFlows, worktreeManager, hookStore, mergeArena,
     splitManager, graphService, commentStore, background-workers). Each later
     step shrinks the allowlist; step 09 empties it.

## Libraries used

- `prisma` + `@prisma/client` (Apache-2.0, actively maintained) — **new dependency,
  approved via Q1.**
- Postgres 16 via `docker-compose` (not an npm dep).
- Optional, decide during the step: PGlite for hermetic unit tests (Apache-2.0) —
  default stays dockerized Postgres for JSONB/advisory-lock fidelity.

## Risks

- **Largest single diff in the overhaul.** Mitigation: purely mechanical conversion,
  no behavior edits; step-00 sanity tests must pass identically; review by module,
  not by diff size. Freeze all `schema.sql` changes for the duration.
- **Async ripple into guard reads** (`nodeStatus`, `nodeRunning`, `chainBusy`) can
  subtly reorder claim checks. Mitigation: convert one runtime module at a time
  (activator → scheduler → reconciler → managers), run the suite after each.
- **Sync-transaction call sites** (`stepFlowManager.expand` is the known one) must
  become async interactive transactions — verify no `await` of agent/git I/O inside.
- **Prisma enum migrations** are sticky (adding values is easy, removing is not):
  get the status vocabularies right in task 1 (include `skipped` on flows).
- Dev-machine requirement changes (Docker). Call out in README; provide
  `DATABASE_URL` pointing at any Postgres for the Docker-averse.

## Acceptance criteria / tests

- Identical test profile to end of step 00: every green test green, every
  `test.fails` still failing the same way (no flips in this step).
- New arch test `tests/architecture/noSqliteInLib.test.ts`: no `better-sqlite3`
  import under `lib/` (migration script excepted).
- Data migration verified on a copy of the dev DB: per-table counts match; spot
  JSONB fields (`nodes.input/output`, `artifacts.meta`) parse identically.
- `npm run check` + `npm run build` green; seeds run against the demo Postgres DB;
  app boots and the demo flow renders end-to-end.
