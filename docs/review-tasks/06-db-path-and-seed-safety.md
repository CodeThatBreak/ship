# Task 06: Separate the prod DB from the demo DB and make seed scripts safe

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md)
- **Findings:** CR-040, CR-157, CR-159, CR-272, CR-262
- **Effort:** M

## Goal

`.env.example` points `next start` at the demo DB that seeds reset, the seed guard is a single-path blacklist, and seed resets miss child tables. Fix the data-safety issues before anyone runs a seed against real data.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-040 [High] `.env.example` sets `DATABASE_PATH`, which defeats the production-DB separation, so `next start` uses the demo/seed DB`

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** .env.example:2, lib/config.ts:28-46, scripts/init-prod-db.mjs:16, README.md:50, README.md:227-228
- **What to do:** `.env.example` still sets `DATABASE_PATH=./data/devflow.db` and README still says `cp .env.example .env`, so `DatabaseConfig.path()` never takes the `devflow.prod.db` branch under `next start` and production shares the seed/demo DB; `db:init:prod` creates a file the server then ignores. Comment out `DATABASE_PATH` in `.env.example` (or split `DEMO_DATABASE_PATH`/`DATABASE_PATH`) and have `init-prod-db.mjs` warn when `DATABASE_PATH` is set.

### CR-157 [Medium] Seed DB guard is a single exact-path blacklist with no allowlist, no realpath and no echo of the target

- **Status:** Fixed
- **Type:** Infra
- **Effort:** S
- **Where:** scripts/lib/seed-db.mjs:18-29, scripts/seed-demo-flow.mjs:27, scripts/seed-demo-fanout.mjs:38, scripts/seed-branch-refine-demo.mjs:39, scripts/seed-custom-flow.mjs:28, scripts/seed-split-smoke.mjs:47
- **What to do:** `resolveSeedDb` is still an exact-path blacklist of `data/devflow.prod.db` with no realpath and no allowlist, and no seed script prints the resolved target before writing. Any other path, symlink or prod copy is accepted (now five callers, including the new `seed-split-smoke`). Fix: allowlist `<root>/data/devflow.db` after `fs.realpathSync`, require an explicit flag for anything else, and always log the target path.

### CR-159 [Medium] Seed `reset()` table lists drifted from the engine's `FLOW_CHILD_TABLES` (missing `hooks`, and `step_merges` in 3 of 4 scripts)

- **Status:** Fixed
- **Type:** Infra
- **Effort:** S
- **Where:** scripts/seed-demo-flow.mjs:195-206, scripts/seed-branch-refine-demo.mjs:270-281, scripts/seed-custom-flow.mjs:65-80, scripts/seed-demo-fanout.mjs:128-147, lib/engine/flow-engine.ts:59-70
- **What to do:** The canonical `FLOW_CHILD_TABLES` (now in `flow-engine.ts`) includes `step_merges` and `hooks`. All four reset loops still omit `hooks`, and three still omit `step_merges` and child flows (`parent_flow_id`). With better-sqlite3's default `foreign_keys=1`, `DELETE FROM flows` can then fail, or leave orphans. Fix: add one shared `deleteFlowCascade(db, flowId)` to `scripts/lib/seed-db.mjs` that mirrors `FLOW_CHILD_TABLES` (children first, plus `parent_flow_id` children), and add a vitest that asserts the lists match.

### CR-272 [Low] `seed-split-smoke --reset` throws a foreign-key error when smoke flows exist

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** scripts/seed-split-smoke.mjs:263-268, scripts/seed-split-smoke.mjs:191-197, lib/db/schema.sql:22
- **What to do:** The new `seed-split-smoke --reset` keeps the template when flows reference it, but then unconditionally runs `DELETE FROM tasks WHERE id=TASK_ID`. `flows.task_id REFERENCES tasks(id)` and better-sqlite3 enforces FKs by default, so the reset throws SQLITE_CONSTRAINT_FOREIGNKEY whenever a smoke flow exists. Fix: delete the task's flows through the shared cascade helper from CR-159 first, or skip the task delete with a message, as the template branch does.
- **Fix after:** CR-159 (this task)

### CR-262 [Low] Seed scripts duplicate boilerplate and hand-replicate engine logic

- **Status:** Partly fixed (shared bootstrap/time helpers in `seed-db.mjs`; engine replicas remain)
- **Type:** Infra
- **Effort:** M
- **Where:** scripts/seed-demo-flow.mjs:30-35,151-195,227, scripts/seed-demo-fanout.mjs:41,64-66,128, scripts/seed-branch-refine-demo.mjs:42-47,158-159,270, scripts/seed-custom-flow.mjs:37-42,65, scripts/seed-split-smoke.mjs:50,68, scripts/lib/seed-db.mjs
- **What to do:** All seed scripts now share only `resolveSeedDb` from scripts/lib/seed-db.mjs. Each still re-declares the WAL/schema bootstrap, `now` / `minsAgo` / `uid` and `reset()`. seed-demo-flow still carries engine replicas of `syncStepsFromPlan` / `markStepsDone` and a hand-copied `createFlow` INSERT, and seed-branch-refine-demo replicates `mergeBranchRefine` from plan-node. Move the shared helpers into scripts/lib/seed-db.mjs, and long term seed through the real `PlanStepStore` / `FlowEngine` APIs (for example as TS scripts or vitest fixtures) instead of replicas.
- **Fix after:** CR-261 ([Task 56](56-docs-refresh.md))

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
