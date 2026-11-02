# Task 23: Graph validation: loops, cycles, edge shapes, one validator

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md)
- **Findings:** CR-007, CR-062, CR-063, CR-032
- **Effort:** M

## Goal

Loop re-entry deadlocks on skipped branches, `next`-edge cycles save fine, the validator accepts edges the runtime ignores, and the client's live validation is weaker than save. Extract one pure structural validator used by `/validate`, save and the editor.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-007 [High] Loop re-entry never resets `skipped` nodes, so the second iteration deadlocks on a previously skipped branch

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:1002-1022 (resetLoopEntry), 941-943 (statusTerminalSuccess), 1171 (startNodeStage pending guard)
- **What to do:** `resetLoopEntry` still resets and walks only `done`/`approved` nodes, so a branch that was `skipped` in iteration 1 stays `skipped`, and `startNodeStage` silently returns on the second pass. Treat `skipped` as resettable in the loop walk and add a two-iteration decision-in-loop engine test.

### CR-062 [Medium] Template validation has no cycle detection on `next` edges

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** lib/engine/templates/template-store.ts:799-811, lib/engine/templates/template-lint.ts:352-358
- **What to do:** `validated()` still rejects only unknown endpoints, self-edges and duplicates; a `next`-edge cycle (A→B→A) saves fine and then idles silently (join `all`) or becomes an unconditional re-entry (join `any`). Add a DFS/Kahn check over `kind==="next"` edges that rejects with "use a loop edge for re-entry", plus a template-store test.

### CR-063 [Medium] Validator accepts edge shapes the runtime silently ignores (labels on non-decision edges, conditions on decision edges)

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:1041-1057, lib/engine/templates/template-store.ts:812-829, lib/engine/templates/template-lint.ts:352-358
- **What to do:** `edgeActive` still returns false for any labeled edge out of a non-decision node and ignores `condition` on decision edges, yet `validated()` only checks decision out-edges and lint still compiles decision-edge conditions. Reject labels on non-decision-source edges and conditions on decision out-edges in `validated()`, mirrored as lint problems with `edgeIndex`.

### CR-032 [High] Client lets authors build graphs that save rejects; live validation never catches them

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** components/builder/hooks/use-editor-actions.ts:173 (duplicateNode), 261 (addEdge dedupe), 336-355 (addCatalogNode: only Start is singleton); components/template-editor/draft.ts:51-60 (uniqueKey); components/template-editor/EdgeEditor.tsx:85-102; components/template-editor/components/BuilderFlow.tsx:167-175; components/template-editor/hooks/use-template-validation.ts:85-100; app/api/templates/[id]/validate/route.ts:62 (lintTemplate only); lib/engine/templates/template-store.ts:776-800 (validated)
- **What to do:** Unchanged: `/validate` still runs only `lintTemplate`, while save's `TemplateStore.validated()` also enforces built-in keys, the key regex, edge dedupe and trigger normalization, so the client can build graphs (`plan_copy`, `plan_2`, digit-leading keys, EdgeEditor self or duplicate edges, stale decision labels) that pass live validation and then fail on save. Extract the structural rules into a shared pure validator run by both `/validate` and save, and tighten the client actions (no Duplicate for built-ins, built-ins as singletons, filtered EdgeEditor targets).

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
