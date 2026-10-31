# Task 49: Declarative node base class and registry

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 26: Validate node config at run time](26-node-config-validation.md)
- **Findings:** CR-093, CR-096, CR-208
- **Effort:** M

## Goal

Four declarative nodes duplicate `runConfig`, `holdsForApproval` and constructor boilerplate, dispatch through two parallel `switch` blocks with a module-level cache, and `merge-request-service.ts` mixes several exports.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-093 [Medium] Declarative nodes copy-paste the same helpers

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** holdsForApproval: lib/engine/nodes/kinds/agent/agent-node.ts:582-588, lib/engine/nodes/kinds/http/http-node.ts:232-236, lib/engine/nodes/kinds/decision/decision-node.ts:394-398, lib/engine/nodes/kinds/script/script-node.ts:293-297; runConfig: agent-node.ts:420-423, http-node.ts:227-230, decision-node.ts:272-275, script-node.ts:289-292; http-node.ts:195-221 vs lib/engine/nodes/shared/template-renderer.ts:35-51; decision-node.ts:10
- **What to do:** `{{a.b.c}}` rendering moved to the shared `TemplateRenderer` (used by agent and decision), and the unused `renderAgentPrompt` import in http-node is gone. Still duplicated: `holdsForApproval` ×4, `runConfig` ×4, the constructor/description/defaultConfig boilerplate ×4, and http's own `interpolate` path walk. Decision still imports `extractJson` from the sibling `agent/` kind. Fix: an abstract `DeclarativeNode<Def>` owning def/runConfig (strict)/holdsForApproval/description. Make http use `TemplateRenderer` with a secrets hook, and move `extractJson` to `nodes/shared`.
- **Fix after:** CR-077 ([Task 26](26-node-config-validation.md))

### CR-096 [Medium] The declarative def cache is module-level mutable state, and kinds dispatch through `switch` instead of a registry

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/nodes/declarative.ts:16, 53-61, 69-80; lib/engine/nodes/declarative-schemas.ts:148-173
- **What to do:** Unchanged. A module-level `const cache = new Map()` breaks the singleton rule and goes stale across HMR. Kinds still dispatch through two parallel `switch (row.kind)` blocks. Fix: a `DeclarativeKindRegistry` (kind → schema + ctor) and a `DeclarativeDefCache` created via `lib/singleton.ts`, used by both `parseDeclarativeConfig` and `instantiateDeclarative`.

### CR-208 [Low] `merge-request-service.ts` mixes several exports, duplicates its own helper, and isn't a node

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/merge-request/merge-request-service.ts:13-49,76-82; lib/engine/nodes/chains/sdlc-chain.ts:30-34,98
- **What to do:** One file still holds `CommitError`, `isCommitError`, `HOOK_PATTERNS`, `isHookRejection` and `MergeRequestService`. `create()` still inlines `HOOK_PATTERNS.some(...)` instead of calling `isHookRejection`. `MrCreationFailed` is still built from any error message. The services still live in the `nodes/` tree (now `nodes/kinds/merge-request` and `nodes/chains`). Fix: move the errors to `merge-request/errors.ts`, call `isHookRejection`, and consider relocating these orchestration services out of `nodes/`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
