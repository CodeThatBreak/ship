# Task 04: Enforce the client/server and feature-barrel boundaries

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** [Task 03: Harden ESLint so new code cannot regress](03-lint-rule-hardening.md)
- **Findings:** CR-161, CR-165, CR-166
- **Effort:** S
- **Needs approval:** Adding `server-only` to `package.json` is a new dependency. Ask before adding it.

## Goal

The `lib/` client-import guard skips `hooks/`, `types/` and `constants/`, `server-only` is not declared or enforced, and the barrel rules cover only some features. Close the gaps so layering can't drift again.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-161 [Medium] The client `lib/` import guard skips `hooks/`, `types/` and `constants/`; live violations in `hooks/use-highlighted-code.ts` and `types/start-contract.ts`

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** eslint.config.mjs:108-110, hooks/use-highlighted-code.ts:3, lib/highlighter.tsx:1-7, types/start-contract.ts:13-17, types/template-lint.ts:7
- **What to do:** The `lib/` client-import rule still covers only `app/**` and `components/**`, so `hooks/`, `types/` and `constants/` are unchecked. `hooks/use-highlighted-code.ts` still imports the non-allowlisted `@/lib/highlighter`, and `types/start-contract.ts` re-exports the runtime `parseStartContract` from `lib/engine/nodes/kinds/start/contract`. `types/template-lint.ts` is type-only but points at `lib/engine/templates/template-lint.ts`, which imports `db`. Fix: extend the rule's `files` to `hooks/**`, `constants/**` and `types/**` (type-only allowed), move `highlighter.tsx` out of `lib/`, move the start-contract schema to a client-safe module, and define `LintProblem` in `types/`.

### CR-165 [Medium] `server-only` is neither a declared dependency nor lint-enforced; 9 `lib/` modules with db/fs/child_process imports lack it

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** package.json:13-58, lib/engine/flow-engine.ts:1, lib/engine/runtime/flow-poller.ts:1, lib/engine/runtime/flow-reconciler.ts:1, lib/engine/runtime/fanout/step-flow-manager.ts:1, lib/engine/templates/template-lint.ts:1, lib/engine/templates/template-store.ts:1, lib/engine/runtime/fanout/merge-arena.ts:1-3, lib/engine/nodes/shared/run-context.ts:1-3, lib/engine/nodes/kinds/script/script-node.ts:1-3
- **What to do:** `server-only` is still not a declared dependency (vitest stubs it; Next aliases it). All nine named modules, at their renamed paths, import `db`, `fs` or `child_process` with no marker. Only 36 of 139 non-test `lib/*.ts` files have `import "server-only"`. Fix: add `server-only` as a dependency (ask first), add the marker to these files and to every lib module outside the client allowlist, and optionally add a vitest that greps for it.

### CR-166 [Medium] The settings barrel omits `SettingsProvider`/`useSettings`, forcing deep imports that the partial cross-feature barrel lint rule lets through

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/settings/index.ts:7-8, app/(workspace)/settings/layout.tsx:1, app/(workspace)/settings/page.tsx:3, app/(workspace)/settings/integrations/page.tsx:4, app/(workspace)/settings/repositories/page.tsx:3, components/settings/repos/ReposSection.tsx:4, components/settings/repos/components/RepoCard.tsx:3, components/settings/repos/hooks/use-repo-form.ts:3, eslint.config.mjs:132-154
- **What to do:** The settings barrel still exports only fetchers and types, so the four settings routes deep-import `@/components/settings/context`, and `repos/*` self-imports it by absolute path. The lint patterns still miss single-segment deep imports, keep the dead `@/components/panels` entry (that directory no longer exists), and don't guard the `flows`, `chat`, `builder`, `tasks` or `templates` barrels. Fix: export `SettingsProvider` and `useSettings` from the barrel and switch the imports to it, then replace the per-feature patterns with a generic `@/components/*/*` rule plus exceptions, and drop the `panels` entry.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
