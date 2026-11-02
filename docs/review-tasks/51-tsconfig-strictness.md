# Task 51: Stricter TypeScript flags

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 46: Remove `any`, `!` and unsafe casts in the backend](46-backend-types-cleanup.md)
- **Findings:** CR-258
- **Effort:** M

## Goal

Enable `noFallthroughCasesInSwitch` and `noImplicitReturns` (0 new errors), then `noImplicitOverride` (about 41), then plan the `noUncheckedIndexedAccess` burn-down (about 186).

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-258 [Low] tsconfig strictness gaps: no `noUncheckedIndexedAccess` or `noImplicitOverride`; `.mjs` scripts are not type-checked

- **Status:** Partly fixed (see Follow-up)
- **Type:** Infra
- **Effort:** M
- **Where:** tsconfig.json:2-20
- **What to do:** None of the flags are enabled, and `checkJs` is still off for scripts/*.mjs. Re-measured on the current tree: `noFallthroughCasesInSwitch` + `noImplicitReturns` add 0 new errors, `noImplicitOverride` adds ~41 (52 total vs an 11-error baseline), and `noUncheckedIndexedAccess` adds ~186 (197 total). Enable the free flags now, then `noImplicitOverride`, then plan the indexed-access burn-down.
- **Fix after:** NEW-H1

## Follow-up

- [Task 63: Enable `noUncheckedIndexedAccess`](63-no-unchecked-indexed-access.md) — burn-down plan and file-level error counts (189 errors measured 2026-10-31).
- **Remaining CR-258 scope:** `checkJs` / `// @ts-check` for `scripts/*.mjs` (defer until Task 63 or a tiny scripts-only PR).

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical). *(N/A — mechanical `override` / tsconfig only.)*
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
