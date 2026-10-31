# Task 12: Transaction API and atomic multi-writes

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 08: Canonical schema, atomic bootstrap, no legacy migrations](08-db-bootstrap-and-schema.md)
- **Findings:** CR-012, CR-050, CR-067
- **Effort:** M

## Goal

There is no `transaction()` anywhere. Add `Database.transaction(fn)`, then wrap flow create/delete, checklist replace, template graph writes, template save with drafts, and YAML import.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-012 [High] The DB façade has no transaction API, so no multi-step write in the engine is atomic

- **Status:** Fixed (Task 12)
- **Type:** Bug
- **Effort:** M
- **Where:** lib/db/index.ts:858-868 (get/all/run only, no transaction API); lib/engine/flow-engine.ts:95 (create), 173 (createStepChild), 546 (delete); lib/engine/runtime/fanout/step-flow-manager.ts:233 (expand); lib/engine/runtime/plan-step-store.ts:142 (replace), 207 (replaceBranch); lib/engine/templates/template-store.ts:321 (create), 337 (duplicate, hand-rolled rollback), 442 (delete), 856 (writeNodesAndEdges)
- **What to do:** There is still no `.transaction(` call anywhere in `lib/` or `app/`, so every multi-statement write (flow create, checklist replace, template graph replace, delete) can leave partial rows. Add `Database.transaction<T>(fn: () => T): T` (synchronous callback around `conn.transaction(fn)()`), wrap the listed methods in it, and remove the manual rollback in `duplicate()`.

### CR-050 [Medium] Template save creates draft node templates in the route, with a manual, non-transactional rollback

- **Status:** Fixed (Task 12)
- **Type:** Bug
- **Effort:** M
- **Where:** app/api/templates/[id]/route.ts:49-77,89-125
- **What to do:** `applyDraftNodeTemplates` still lives in the route, mutates the request body, creates rows one by one, and rolls back by deleting them with errors swallowed (`catch { /* keep rolling back */ }`), with no transaction around create + `templateStore.update`. Move into `TemplateStore.saveWithDrafts(id, input)` wrapped in a single `db.transaction`.
- **Fix after:** CR-012 (this task)

### CR-067 [Medium] Failed YAML import "rollback" deletes pre-existing node templates it merely reused

- **Status:** Fixed (Task 12)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/templates/template-yaml.ts:251-261,292-298, lib/engine/templates/template-store.ts:729-760
- **What to do:** `ensureNodeTemplate` still returns a bare id (an existing identical row's id when one matches) and the importer pushes it into `createdNodeTemplateIds` unconditionally, so a failed import's rollback deletes a user's pre-existing, currently unreferenced Library definition. Return `{ id, created }` (like `createOrReuseNodeTemplate`) and push only when `created`.
- **Fix after:** CR-012 (this task)

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
