# Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 02: Make typecheck, lint and tests real gates](02-typecheck-and-build-gates.md)
- **Findings:** CR-041, CR-164, CR-160, CR-267
- **Effort:** M

## Goal

Vitest exists and 23 files pass, but the row mappers, the template YAML importer, template lint and the start-contract coercion have no tests, and the old `scripts/check-*.ts` cannot run. Port them so later fixes land with regression tests.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-041 [Medium] No test runner and no tests anywhere, although the Definition of Done requires tests for service classes and row mappers

- **Status:** Fixed (Task 05)
- **Type:** Infra
- **Severity:** Medium (was High)
- **Effort:** M
- **Where:** lib/db/rows.ts, lib/engine/templates/template-yaml.ts, lib/engine/templates/template-lint.ts, lib/engine/nodes/kinds/start/contract.ts, lib/git/worktrees.ts, lib/git/dep-policy.ts, lib/integrations/gitlab/git-host.ts, lib/net/ssrf-guard.ts, tests/plan-diff.test.ts
- **What to do:** vitest, `vitest.config.mts` (server-only stub + `@` alias), the `test` script and 23 test files now exist (plan node/store/contract, split, agent output errors, a DB column-migration test). Still missing: tests for the `lib/db/rows.ts` mappers, `parseTemplateYaml` + an import-every-`docs/flow-templates/*.yaml` test, template-lint, start-contract coercion, and the git/dep-policy/GitLab/SSRF helpers; `tsc --noEmit` also fails in `tests/plan-diff.test.ts`, which vitest does not type-check.

### CR-164 [Medium] `docs/flow-templates/review-notes.yaml` uses an invalid `wait_for` and a non-existent output field

- **Status:** Fixed (Task 05)
- **Type:** Bug
- **Effort:** S
- **Where:** docs/flow-templates/review-notes.yaml:23, docs/flow-templates/review-notes.yaml:33, lib/engine/templates/template-store.ts:957-968, lib/engine/constants/triggers.ts:26, lib/engine/nodes/kinds/review/schema.ts:18
- **What to do:** The fixture still uses `wait_for: gitlab_pipeline`, which is not in `WAIT_FOR_SOURCES`, so `nodeTrigger()` still silently drops it and the pipeline node loses its gate. It also still references `nodes.review.output.comment_count`, but the review node publishes `comments`. Nothing imports the docs fixtures in tests. Fix: change these to `pipeline` and `.comments`, make `nodeTrigger`/validation reject unknown `wait_for` and trigger types with a lint error, and add a vitest that imports every `docs/flow-templates/*.yaml`.

### CR-160 [Medium] Every `scripts/check-*.ts` and `cursor-usage.ts` is unrunnable as documented

- **Status:** Partly fixed — check scripts ported/deleted; `cursor-usage.ts` remains an ops probe
- **Type:** Infra
- **Effort:** M
- **Where:** scripts/check-branch-refine.ts:4, scripts/check-worktrees.ts:12, scripts/check-plan-turn-output.ts:4, scripts/cursor-usage.ts:7-8, scripts/check-prompt-splits.ts:3, scripts/check-prompt-assembly.ts:10, package.json:5-12
- **What to do:** vitest now exists with a `server-only` stub (`tests/server-only-stub.ts`) and 23 passing test files, so the runner prerequisite is done. The check scripts are still not ported: `check-branch-refine` still documents `node --experimental-strip-types` (verified: ERR_MODULE_NOT_FOUND), `check-worktrees`, `check-plan-turn-output` and `cursor-usage` still use `npx tsx` (not installed), and none are wired into `package.json`. Remaining: port the checks into `*.test.ts` under vitest and delete the scripts that have no purpose left.

### CR-267 [Low] `check-worktrees.ts` leaks its temp workspace on failure

- **Status:** Fixed (Task 05 — script removed; Vitest uses `afterAll` cleanup)
- **Type:** Infra
- **Effort:** S
- **Where:** scripts/check-worktrees.ts:84,703-715
- **What to do:** The `mkdtemp` workspace is still removed only on the success path of `all()`, so any failure exits through `.catch` with the directory left behind. Wrap the body of `all()` in try/finally around `fs.rmSync(tmp, …)`, or port the check to vitest with `afterAll` cleanup.

## Additional steps

- Add a shared in-memory DB test helper (if `lib/db/index.test.ts` doesn't already expose one) that later tasks reuse.
- Port each runnable check in `scripts/check-*.ts` into a `*.test.ts`, then delete the scripts that have no remaining purpose (this also resolves the temp-dir leak in CR-267).

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
