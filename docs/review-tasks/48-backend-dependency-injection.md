# Task 48: Constructor injection and a smaller `Database` class

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 08: Canonical schema, atomic bootstrap, no legacy migrations](08-db-bootstrap-and-schema.md)
- **Findings:** CR-095, CR-118, CR-116
- **Effort:** L

## Goal

`AgentRunner`, the integration services and `RowGateway` import module singletons, and `Database` is about 1,000 lines. Inject dependencies and split `Database` into connection, migrator, seeder and stores.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-095 [Medium] Nodes and base services reach into the DB and other nodes' rows directly, and the "injected" services aren't really injected

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** L
- **Where:** lib/engine/harness/agent-runner.ts; lib/engine/nodes/kinds/build/build-node.ts; pipeline/review nodes; resolve still uses `gitHostRegistry`
- **What to do:** Constructor-injected `AgentRunner`; plan publishes `model` in output for build; optional `GitHostResolver` on pipeline/review. **Remaining:** resolve / merge-request / flow-poller still call `gitHostRegistry` directly (note in PR if not extended).

### CR-118 [Medium] Integrations and row gateway import the global `db` instead of taking injected dependencies

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** M
- **What to do:** Instance stores extracted; services and `RowGateway` constructor-injected; composition via `wireGitHostBuiltins` and lazy integration singletons (`getDb()`).

### CR-116 [Medium] `lib/db/index.ts` is a god module: connection, migrations, data fixes, seed content and four domain stores

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** L
- **What to do:** Split into `Database`, `SchemaMigrator`, `TemplateSeeder`, `lib/db/stores/*`; thin `lib/db/index.ts`.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
