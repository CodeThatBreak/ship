# Task 07: Delete dead code and legacy back-compat paths

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md)
- **Findings:** CR-187, CR-207 (plus legacy cleanup for CR-263)
- **Effort:** S

## Goal

The product does not support legacy or deprecated flows. Delete the code that only exists for them, and the dead code the review found, before fixing anything around it. Every line removed here is one fewer line to harden later.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-187 [Low] Dead code and no-ops

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:1167-1170 (`latestMergeStatus` unused), 921-926 (node fetched only for presence); lib/engine/runtime/fanout/merge-arena.ts:67-71 (`dropLocks` never called), 245 (`void pushed`); lib/groupEvents.ts:92,273 (`finalizeSection` no-op); lib/engine/flow-engine.ts:437-440 (try/catch that cannot throw); lib/format.ts:51 (unused `n`); lib/engine/tasks/providers/jira.ts:293 (`join(cond ? "" : "")`); lib/net/ssrf-helpers.ts:22 (`RESOLVE_TIMEOUT_MS` unused)
- **What to do:** All cited dead code and no-ops still exist at the moved paths. Delete them, or wire `RESOLVE_TIMEOUT_MS` into the DNS lookup (see CR-189).

### CR-207 [Low] Dead code and dead parameters

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/start/contract.ts:87-102; lib/engine/nodes/kinds/script/script-node.ts:168,200-208; lib/engine/nodes/kinds/build/step-build-node.ts:142,290-293; lib/engine/nodes/kinds/plan/plan-context.ts:29,122-123; lib/engine/nodes/shared/node-definition.ts:197
- **What to do:** The unused `renderAgentPrompt` import in the HTTP node is gone. Still open: `startContractZod` is exported but never imported (and still ignores `required`), `extractOutput(cfg, …)` still exists only to `void cfg`, `parentPlanMarkdown` is `async` with no await, `renderVersions` is still "dead code kept reachable", and the base `triggerInput(ctx)` has an unused parameter. Fix: delete or underscore them as the original suggests.

## Legacy code to delete

These findings are obsolete because they only affect legacy or deprecated flows, which are no longer supported. Don't fix them. Delete the leftover code instead.

- **CR-263** `sentry-triage.yaml` declares `trigger.type: webhook`, which import silently coerces to `manual`: Fixed — fixture uses `manual`; unknown flow trigger types fail import.

## Additional steps

- Decision node: delete the single global `expression` path (`decision-node.ts` legacy branch, `normalizeChosen`, the `expression` field in `declarative-schemas.ts`). Unknown shapes must fail validation, not be coerced.
- Template import: make unknown flow trigger types an import error instead of coercing them to `manual`, and fix `docs/flow-templates/sentry-triage.yaml` to `type: manual`.
- Delete the unused `PlanOptionToggles` component and any other export with zero importers (check with `rg`).
- Delete `renderVersions` and the other dead paths listed in CR-187 and CR-207.
- Do not add shims, normalizers or fallbacks for old data shapes. If old data shows up, fail loudly.

## Done when

- [x] `rg -i legacy lib components app` returns only comments you have checked and kept on purpose.
- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
