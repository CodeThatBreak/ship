# Task 56: README, AGENTS.md commands and stale plan docs

- **Phase:** Phase 5: Docs
- **Depends on:** [Task 06: Separate the prod DB from the demo DB and make seed scripts safe](06-db-path-and-seed-safety.md)
- **Findings:** CR-260, CR-261, CR-268
- **Effort:** S

## Goal

The README documents removed env keys, routes and npm seed scripts. AGENTS.md references seed commands that no longer exist. Fourteen plan docs cite about 100 paths that were renamed.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-260 [Low] README is stale in several places (env keys, routes, paths, local-mode description)

- **Status:** Open
- **Type:** Docs
- **Effort:** S
- **Where:** README.md:9-10,16,58-61,73-74,89,124-125,165,226,261,277
- **What to do:** The README still documents `CURSOR_API_KEY` / `JIRA_*` env keys (.env.example says credentials live in the DB), `/tasks/import`, `components/panels/`, the `GITLAB_BASE_URL/TOKEN` fallback, and a cursor-agent CLI description of local mode that contradicts line 277. It got worse: it now documents `npm run seed:demo`, `seed:demo:fanout`, `seed:custom` and their `:reset` variants, all removed from package.json. Rewrite the env table from .env.example, fix the paths and routes, unify local mode on the SDK, and document seeds as `node scripts/seed-*.mjs` (or restore the npm scripts).

### CR-261 [Low] AGENTS.md seed command variants don't match `package.json`

- **Status:** Open
- **Type:** Docs
- **Effort:** S
- **Where:** AGENTS.md:17,32, package.json:5-12
- **What to do:** The mismatch has widened. AGENTS.md §0 still says `npm run seed:demo` (with variants) and §1 names `seed:demo:reset`, but package.json no longer defines any seed script, so the documented command fails. Update §0 to the real invocation (`node scripts/seed-*.mjs`, or re-add npm scripts), and reword §1 to cover every seed script with a reset mode.
- **Fix after:** CR-260 (this task)

### CR-268 [Low] Design and plan docs reference files that no longer exist

- **Status:** Open
- **Type:** Docs
- **Effort:** S
- **Where:** docs/phase0-baseline.md, docs/pristine-plan.md, docs/tasks-plan.md, docs/custom-flows-plan.md, docs/worktree-support.md, docs/prompt-flow-fix-plan.md, docs/plan-conversation-refine.md, docs/node-definition-refactor-plan.md, docs/step-sub-flows-plan.md, docs/worktree-ensure-impl-plan.md, docs/worktree-ensure-runner.md, docs/refinement-plan.md, docs/template-editor-ux-plan.md, docs/prompt-flow-inconsistencies.md, eslint.config.mjs:38,92
- **What to do:** Re-checked against current docs/: 14 docs now cite ~100 backticked paths that don't exist (~70 genuine full-path misses, vs 17 at review time), because of the renames (lib/engine/flow.ts, templates.ts, nodes/base/*, jsonata-eval.ts, components/flows/plan/*). Some newly added docs are already stale, docs/pristine-plan.md still links docs/ai-elements-migration.md (missing) and docs/repo-detail-page.md (now only in docs/archive/), and eslint.config.mjs still cites phase0-baseline.md (28 stale refs) as its verification source. Move completed plan docs to docs/archive/ with a "paths may be stale" banner, and refresh phase0-baseline.md or repoint the lint comments to docs/architecture/.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
