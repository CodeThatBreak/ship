# Step 01 working notes (delete before final report if undesired)

## Baseline (pre-migration)
- `npm test`: 152 files pass / 1 fail (`tests/eslintConfig.test.ts` — pre-existing
  WSL eslint cold-start timeout, >30s; NOT caused by this step) / 1 skipped.
  654 passed, 16 expected-fail (test.fails), 3 skipped.
- `test.fails` inventory: 16 across tests/engine-overhaul/* + tests/architecture/noRawNodeStatusWrite.

## Plan order
1. deps: prisma + @prisma/client; keep better-sqlite3 (devDep for migration script)
2. prisma/schema.prisma (22 tables, Q11 camelCase+@map, enums, JSONB, timestamptz)
3. docker-compose.yml + start PG (dev db `devflow`, test db `devflow_test`)
4. lib/config.ts DATABASE_URL; .env.example
5. lib/db/prismaClient.ts (sole processSingleton)
6. prisma migrate dev (both DBs)
7. arch tests: noSqliteInLib, prismaSchemaCasing, noProcessSingletonOutsideDb (test.fails, 39-site inventory)
8. Database facade rewrite (async; Prisma-backed); rows.ts → camelCase JSONB validators
9. Convert call sites (~80 files) sync→async, snake_case→camelCase
10. tests/helpers/testDatabase.ts (PG test DB, truncation); vitest globalSetup
11. scripts/migrate-sqlite-to-pg.mjs (better-sqlite3 reader, batched Prisma writes, count + JSONB spot verification, demo-only)
12. seed scripts → Prisma (demo DB, --reset guard)
13. npm scripts db:up/db:migrate/db:seed/db:test:setup; README; AGENTS.md §1/§3.3; coding-patterns §3.5; docs/architecture/database.md
14. lib/composition/container.ts scaffolding
15. Gates: typecheck, lint, test, build; verify identical test profile

## Key decisions
- Raw-SQL `?` placeholders → `$1,$2,...` for prisma.$queryRaw/$executeRaw.
- `.changes` counts → $executeRaw return value.
- INSERT OR IGNORE → ON CONFLICT DO NOTHING via $executeRaw.
- db.uid()/db.now() stay app-side on the facade.
- JSONB columns: Prisma Json? — pass objects directly, no JSON.stringify.
- timestamptz: Prisma DateTime — rows expose Date objects; ISO strings via .toISOString() at boundaries.
