# Task 28: Prompt preview matches the prompt that is sent

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md)
- **Findings:** CR-004, CR-049
- **Effort:** S

## Goal

`BuildNode.previewPrompt` still hard-codes old local-mode text and resolves the branch differently from `run`, and the branch-scoped plan preview goes through an unchecked downcast.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-004 [High] The prompt preview shows a different local-mode build prompt from the one the build node sends

- **Status:** Partly fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/build/build-node.ts:408-426 (previewPrompt) vs 245-291 (run); lib/engine/prompts/prompt-preview.ts:186-224
- **What to do:** The route now delegates to the node's own `previewPrompt`, but `BuildNode.previewPrompt` still hard-codes the old local-mode text ("First create and check out a new git branch…") while the run says the worktree is "already checked out… do not switch branches". It also resolves the branch differently (`mr_branch ?? buildBranch` vs `buildRun.branchName`) and omits the checklist and setup advisory, so `diverges` is effectively always true after a build. Extract one instructions/branch helper that both `run` and `previewPrompt` call.

### CR-049 [Low] The prompt preview route is a 230-line switch on node key instead of a registry method

- **Status:** Partly fixed
- **Type:** Code quality
- **Severity:** Low (was Medium)
- **Effort:** S
- **Where:** lib/engine/prompts/prompt-preview.ts:90-108,126
- **What to do:** The 230-line switch is gone: `/prompt` and `/prompts` routes are thin and each def builds its own preview via `nodeRoles.promptPreviewerOf(def).previewPrompt(...)` in the `PromptPreview` service. What remains is the branch-scoped plan special case, reached through an unchecked `nodeRegistry.get(NODE_KEYS.PLAN) as unknown as SubPlanPreviewer` downcast, plus the hardcoded `"pipeline_fix"` → `fix_prompt_rules` mapping; fold both into the previewer role (pass `branch` through `PromptPreviewParams`, return `rulesKey` from the def).

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
