# Step 01 working notes

Status: implementation complete — `npm run check` (typecheck + lint + test) and
`npm run build` green; app boots against Postgres and the seeded demo flow
renders end-to-end (verified via `next start` + page/API probes).

## Baseline (pre-migration)
- `npm test`: 152 files pass / 1 fail (`tests/eslintConfig.test.ts` — pre-existing
  WSL eslint cold-start timeout, >30s; NOT caused by this step) / 1 skipped.
  654 passed, 16 expected-fail (test.fails), 3 skipped.
- `test.fails` inventory: 16 across tests/engine-overhaul/* + tests/architecture/noRawNodeStatusWrite.

## End state (verified)
- typecheck 0 errors; lint 0 errors / 3 warnings (pre-existing baseline in
  ChatComposerForm / PlanPanelHeader — untouched files).
- `npm test`: 155 files pass / 1 skipped; 657 passed, 17 expected-fail, 3 skipped.
  Profile vs step 00: engine-overhaul `test.fails` = 15 (identical), noRawNodeStatusWrite = 1
  (identical), +1 authorized new `test.fails` from step-01's own
  `noProcessSingletonOutsideDb` inventory; +2 new arch tests
  (`noSqliteInLib`, `prismaSchemaCasing`).
- Build green; `/`, `/flows`, `/flows/<demo>`, `/templates` and the
  `/api/flows`, `/api/flows/<id>`, `/api/status`, `/api/tasks` endpoints
  verified against `next start`.

## Key decisions
- Raw-SQL `?` placeholders → `$1,$2,...` for prisma.$queryRaw/$executeRaw.
- `.changes` counts → $executeRaw return value / updateMany `.count`.
- INSERT OR IGNORE → ON CONFLICT DO NOTHING.
- db.uid()/db.now() stay app-side on the facade.
- JSONB columns: Prisma Json? — pass objects directly, no JSON.stringify.
- timestamptz: Prisma DateTime — rows expose Date objects; ISO strings via
  .toISOString() at boundaries. Never bind timestamps as raw text (a
  Z-suffixed string is reinterpreted in the session timezone; the prismaClient
  pins the pg session timezone to UTC — @prisma/adapter-pg's
  `normalize_timestamptz` corrupts offset-bearing reads otherwise).
- **Prisma enums declared with lowercase members** (no per-member `@map`): the
  TS values equal the DB labels, so every existing `status === "running"`
  comparison survived the migration with zero ripple (Q11). The
  `prismaSchemaCasing` arch test asserts the convention.
- **Transaction threading:** store methods used inside `db.transaction`
  callbacks take an optional trailing `tx?: Prisma.TransactionClient` and run
  everything on `tx ?? global client`; transaction-owning call sites pass tx
  through. Fixed the FK-violation cluster (FlowFactory/insertSnapshots inside
  tx writing via the global client) and restored rollback semantics.
- **Builtin template seed** ships as the `builtin_template_seed` Prisma
  migration (idempotent ON CONFLICT DO NOTHING, `now()` timestamps) so every
  `migrate deploy` seeds dev/test/prod; `TemplateSeeder` re-seeds truncated
  test DBs. KEEP-IN-SYNC comments cross-reference the two.
- Engine/dev infra on this machine: Docker Desktop not installed — used the
  local Homebrew Postgres (role/db `devflow`, `devflow_test`, `devflow_prod`);
  docker-compose.yml + `npm run db:up` remain the documented path for
  Docker-capable machines.
- `vitest.config.ts`: vitest v5 removed `pool`/`poolOptions` — serialization is
  via `fileParallelism: false`.

## Flagged for the PR description (not fixed here)
- `ts-morph` devDependency has zero consumers after the one-off codemod
  scripts were deleted — remove it (needs `package-lock.json` churn; per
  AGENTS §1, dependency changes ask first).
- `lib/db/schema.sql` is now unreferenced (Prisma schema is the source of
  truth) — candidate for deletion in step 02.
- `better-sqlite3` + `@types/better-sqlite3` stay one extra step per the plan
  (the reader for `scripts/migrate-sqlite-to-pg.mjs`), then remove.
- 3 pre-existing lint warnings (untouched UI files).
- `bakeNodeConfig` in `lib/engine/templates/nodeConfig.ts` is exported but
  unused repo-wide (pre-existing).
- Engine-overhaul next steps inherit the re-pinned engineClassSize values:
  `stepFlowManager` 1340, `templateStore` 1233, `splitManager` 693,
  `worktreeLifecycle` 559, `buildNode` 555, `resolveNode` 718, `nodeSupport`
  452 — each must shrink in its decomposition step.
