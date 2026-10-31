# Task 03: Harden ESLint so new code cannot regress

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 02: Make typecheck, lint and tests real gates](02-typecheck-and-build-gates.md)
- **Findings:** CR-162, CR-170
- **Effort:** M

## Goal

All 143 lint warnings sit in `lib/` and `scripts/`, which are downgraded to `warn` wholesale, so new backend files get no enforcement. Freeze the existing offenders and make everything else an error.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-162 [Medium] AGENTS.md §5 rules are downgraded to `warn` for `lib/**` and `scripts/**`, which hides 56 `any` and about 30 `!`

- **Status:** Open
- **Type:** Infra
- **Effort:** M
- **Where:** eslint.config.mjs:35-55
- **What to do:** The override still downgrades `exhaustive-deps`, `no-explicit-any` and `no-non-null-assertion` to `warn` for the whole `lib/**/*.ts` and `scripts/**` trees; lint currently reports 0 errors and 143 warnings there. The comment still cites the nonexistent "AGENTS.md section 6", and the `lib/**/*.ts` glob still misses `lib/highlighter.tsx`. Fix: keep `warn` only for a frozen per-file offender list so new lib files get `error`, then add `--max-warnings` and burn the list down, and fix the stale reference.

### CR-170 [Low] No DB-touching route declares `runtime = "nodejs"`

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** all 39 app/api/**/route.ts files (none export `runtime`; e.g. app/api/flows/route.ts, app/api/repos/route.ts:6)
- **What to do:** No route declares `export const runtime = "nodejs"`; they only export `dynamic = "force-dynamic"`. Add the declaration to every DB-touching route. Lint now runs, so also add an ESLint rule (restricted-syntax or a custom rule) that requires it under `app/api/**`.

## Additional steps

- Replace the `lib/**` + `scripts/**` downgrade with a frozen list of the files that currently warn; every other file gets `error`.
- Add `--max-warnings=<current count>` to the lint script and lower it as tasks land.
- Set `linterOptions.reportUnusedDisableDirectives: "error"`.
- Add a `no-restricted-syntax` (or small local rule) that requires `export const runtime = "nodejs"` in `app/api/**/route.ts`, then add the export to every route.
- Enable typed linting and `@typescript-eslint/no-floating-promises` for `lib/**` (warn first, with the current offenders frozen). It is the guard for the fan-out bugs in Task 19.
- Fix the stale "AGENTS.md section 6" and `phase0-baseline.md` references in `eslint.config.mjs` comments.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
