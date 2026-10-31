# Task 08: Canonical schema, atomic bootstrap, no legacy migrations

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 07: Delete dead code and legacy back-compat paths](07-remove-dead-and-legacy-code.md)
- **Findings:** CR-021, CR-022, CR-210, CR-221 (plus legacy cleanup for CR-158, CR-211, CR-212)
- **Effort:** M
- **Needs approval:** This changes `lib/db/schema.sql`. Get approval first and update `lib/db/rows.ts` in the same PR (AGENTS.md section 1).

## Goal

`schema.sql` is not the real schema (columns only exist as `ALTER TABLE` in `migrate()`), the connection is cached before migrations finish, and about a dozen legacy migrations and normalizers run on every boot. Make `schema.sql` canonical, delete the legacy migration code, and make bootstrap atomic.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-021 [High] DB connection is cached before schema/migrations finish — a failed migration is never retried and the app runs half-migrated

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** lib/db/index.ts:38-55
- **What to do:** `this.conn` is still assigned before `renameTicketsToTasks`, `exec(schema)` and `migrate()` run, so a failed migration leaves a cached, half-migrated handle for every later caller. Open into a local, run bootstrap and migrations, assign `this.conn` only on success, and otherwise `close()` and throw a typed `DatabaseMigrationError`.

### CR-022 [Medium] Migrations and seeding are not atomic; table rebuilds are not resumable after a crash

- **Status:** Open
- **Type:** Infra
- **Severity:** Medium (was High)
- **Effort:** S
- **Where:** lib/db/index.ts:588-660 (seedTemplates, non-atomic SDLC template seed); legacy-only parts: lib/db/index.ts:64-70, 82-84, 198-208, 466-494, 547-580
- **What to do:** Still applies for the current flow only in part (b): `seedTemplates` inserts `tpl_sdlc_loop`, then its nodes and edges, as separate statements, so a crash in between makes the `hasSdlc` check permanently skip node seeding. Wrap each template seed in one transaction. Parts (a) and (c) concern legacy migrations (tickets→tasks rename, the `tasks_new`/`flows_new` FK and column rebuilds, `pipeline_fix` cleanup). That code still exists and should be deleted as a legacy cleanup task rather than hardened.
- **Fix after:** CR-012 ([Task 12](12-db-transactions.md)), CR-021 (this task)

### CR-210 [Low] `schema.sql` is not the canonical schema; migrations are unversioned and re-run every boot

- **Status:** Open
- **Type:** Infra
- **Effort:** M
- **Where:** lib/db/schema.sql:20-37,39-52,133,151-161; lib/db/index.ts:73-259; scripts/init-prod-db.mjs:21; scripts/seed-custom-flow.mjs:38; scripts/seed-demo-flow.mjs:31
- **What to do:** `schema.sql` is still not canonical. These columns exist only as `ALTER TABLE` in `migrate()`: `flows.execution_mode/repo_id/template_id/trigger_payload`, `nodes.session_id/prompt_override/label/config/join_mode`, and the `runs` model/token/cost columns. So the scripts that bootstrap from `schema.sql` alone produce a DB that does not match `rows.ts`. There is still no `user_version`, every probe and seed re-runs on each boot, and the stray "durable cursor-run handles" comment still sits above `branches`. Fix: fold all columns into `schema.sql` and gate steps on `PRAGMA user_version`. The legacy-data parts of this item should be deleted rather than versioned (see CR-211 and CR-212).
- **Fix after:** CR-022 (this task)

### CR-221 [Low] `schema.sql` is loaded relative to `process.cwd()`

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** lib/db/index.ts:48-51
- **What to do:** `schema.sql` is still read from `path.join(process.cwd(), "lib/db/schema.sql")`, so launching from any other directory throws ENOENT on first DB access. Fix: resolve the path via `config` or embed the schema as a TS string module.
- **Fix after:** CR-021 (this task)

## Legacy code to delete

These findings are obsolete because they only affect legacy or deprecated flows, which are no longer supported. Don't fix them. Delete the leftover code instead.

- **CR-158** Seed scripts and `init-prod-db` run raw `schema.sql` and skip the app's migrations, which can shadow `tickets` data or fail on old DBs: Both harms this finding describes (shadowing a pre-rename `tickets` table, and missing `ALTER TABLE ADD COLUMN` columns on old DBs) apply only to legacy pre-migration DB shapes, which the product owner won't support. The seeds still exec raw `schema.sql` (seed-*.mjs, init-prod-db.mjs:21). The legacy `tickets→tasks` rename and ALTER migrations still exist in `lib/db/index.ts:44-77` and `migrate()`, so they are candidates for a "delete legacy migrations" cleanup.
- **CR-211** Legacy `flows` table rebuild drops constraints and would fail under enforced FKs: This only concerns the legacy tickets-to-tasks `flows` table rebuild, which the product owner no longer wants to support. The legacy code still exists (`lib/db/index.ts:466-494`, inside `migrateTicketsToTasks`, plus `renameTicketsToTasks` at 64-70) and is a candidate for a "delete legacy migrations" cleanup.
- **CR-212** Legacy normalizers do full-table scans plus per-row prepares on every boot: This concerns the legacy data normalizers, which are out of scope now that legacy flows are unsupported. The code still runs on every boot: `normalizeLegacyModelSpecs`/`FlowTriggers`/`Comments`/`McpSources` at `lib/db/index.ts:254-405` (comments still do a full scan plus a prepare inside the loop at 372), and the `gitlab_pipeline` remap and `template_id` backfill at 246-253. Delete them as part of the legacy-code cleanup.

## Additional steps

- Fold every `ALTER TABLE ADD COLUMN` column from `migrate()` into `schema.sql`.
- Delete the legacy migrations and normalizers (tickets→tasks rename and rebuild, `normalizeLegacy*`, `gitlab_pipeline` remap, `template_id` backfill, `pipeline_fix` cleanup). Existing dev DBs that predate the current schema should be recreated, not migrated.
- Introduce `PRAGMA user_version`: version 1 is the canonical schema. Future migrations are numbered steps, each in one transaction.
- Open the connection into a local, run bootstrap, and assign `this.conn` only on success.
- Load the schema from a path resolved via `lib/config.ts` (or a TS string module), not `process.cwd()`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
