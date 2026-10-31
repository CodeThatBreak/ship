# Task 02: Make typecheck, lint and tests real gates

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** nothing, can start any time
- **Findings:** CR-273, CR-257, CR-266
- **Effort:** S

## Goal

`tsc --noEmit` fails with 11 errors that `npm test` and `npm run lint` never report, and `next build` skips lint. Get every check green and make the Definition of Done run all of them.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-273 [Medium] `tsc --noEmit` fails with 11 errors in tests and scripts, and no script runs it

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** tests/plan-diff.test.ts:72,87 (2 errors), lib/engine/runtime/split/split-manager.test.ts:234-236 (3), lib/engine/templates/split-smoke-template.test.ts:300,336-344 (4), lib/engine/nodes/kinds/plan/plan-split-units-demo.test.ts:154 (1), scripts/verify-prompt-parity.ts:214 (1), tsconfig.json:21
- **What to do:** `npx tsc --noEmit` (with or without the incremental cache) currently reports 11 errors in 5 files, not just the single plan-diff error. Vitest doesn't type-check, so `npm test` stays green, and because tsconfig `include` covers `**/*.ts`, these files are also in the program `next build` type-checks. Fix the 11 errors, and add a `typecheck` script (`tsc --noEmit`) to package.json and the DoD so test and script type drift fails fast.

### CR-257 [Low] `eslint.ignoreDuringBuilds: true` means `next build` never lints

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** next.config.mjs:9, AGENTS.md:11-27 (§0 Definition of Done, build-only check at :22)
- **What to do:** `eslint: { ignoreDuringBuilds: true }` is still set, and the DoD still lists only `npm run build`. The blocker is gone: lint now installs and runs with 0 errors (CR-039 is resolved). Remove `ignoreDuringBuilds`, or add `npm run lint` and `npm test` to the AGENTS.md DoD checklist.

### CR-266 [Low] `package.json` has no `engines` field, even though local mode requires Node ≥ 22.13; the `shadcn` CLI is a runtime dependency

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** package.json:13-48, .npmrc:1, app/globals.css:2, README.md:277
- **What to do:** There is still no `engines` field (Node >= 22.13 is required by @cursor/sdk local mode) and no `engine-strict` in .npmrc. `shadcn` (CLI, used only for the `shadcn/tailwind.css` import), `tailwindcss` and `@tailwindcss/postcss` are still runtime dependencies. Add `"engines": { "node": ">=22.13" }`, move build-only packages to devDependencies, or vendor the CSS.

## Additional steps

- Fix the 11 type errors (tests and `scripts/verify-prompt-parity.ts`).
- Add `"typecheck": "tsc --noEmit"` and a `"check"` script that runs typecheck, lint and test.
- Remove `eslint.ignoreDuringBuilds` from `next.config.mjs` (lint has 0 errors now).
- Update AGENTS.md section 0 so the Definition of Done lists `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.

## Done when

- [x] `npm run check` and `npm run build` pass on a clean tree.
- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical). *(Type fixes are covered by existing Vitest files now included in `tsc`.)*
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
