# Task 12 — Lint ratchet + docs: ban new raw SQL outside the containment list

**Files:** `eslint.config.*`, `tests/architecture/`, `docs/coding-patterns.md`, `AGENTS.md`, `docs/orm-migration/README.md`
**Effort:** S · **Depends on:** 11

## Goal

Make the end state self-enforcing: a new raw SQL string outside the documented containment list fails lint/architecture tests, so the migration cannot silently regress.

## Steps

1. **Architecture test** — add `tests/architecture/noRawSqlOutsideContainment.test.ts` (pattern: `noRawNodeStatusWrite.test.ts`): scan `lib/` for `$queryRawUnsafe` / `$executeRawUnsafe` / `$queryRaw` / `$executeRaw` / `db.get(\`` / `db.run(\`` / `db.all(\``; assert every match lives in the allowlist:
   - `lib/engine/runtime/jobs/jobQueue.ts` (claims + backoff)
   - `lib/engine/nodes/shared/nodeSupport.ts` (lease stamps)
   - `lib/engine/runtime/transitions/nodeTransitions.ts` (CAS)
   - `lib/engine/runtime/locks/processLock.ts`, `locks/utils/writerLockStatus.ts` (advisory locks / `pg_locks`)
   - `lib/engine/runtime/reconcile/runningHandler.ts` (staleness interval)
   - `lib/db/templateSeeder.ts` only if Task 06 kept any `ON CONFLICT` raw — prefer empty.
   The allowlist is a named constant with a per-entry justification comment.
2. **ESLint** — if a `no-restricted-syntax` rule can catch the tagged-template call shape cheaply, add it scoped to `lib/**` with the same allowlist; otherwise the architecture test suffices (AGENTS §5 prefers failing lint, but a source-scan test is the existing pattern for this).
3. **Docs** —
   - `docs/coding-patterns.md` §3.5: state the final rule (ORM-first; raw SQL only in the containment list, each entry justified by an invariant) and link `docs/orm-migration/README.md`.
   - `AGENTS.md` §0 DoD: add "no new raw SQL outside the containment list (`noRawSqlOutsideContainment.test.ts`)".
   - `docs/orm-migration/README.md`: tick all tasks, record what was **not** converted (the containment list) and why.
4. Delete `docs/engine-overhaul/steps/01-postgres-prisma-migration.md`'s "migrate incrementally" bridge note if it now describes a finished migration — point it here instead.

## Notes

- This mirrors how `noProcessSingletonOutsideDb.test.ts` enforces the composition-root rule with an allowlist — same enforcement shape, consistent with the repo's conventions.
- Test files (`*.test.ts`, `tests/`) are exempt from the ban (test doubles may stub `$executeRawUnsafe`), but the scan should still assert no *new* production raw SQL.

## DoD

- [x] `noRawSqlOutsideContainment.test.ts` green; adding a raw statement elsewhere fails it.
- [x] `npm run check` + `npm run build` green; `--max-warnings` unchanged or tightened.
- [x] `AGENTS.md` + `docs/coding-patterns.md` updated.
