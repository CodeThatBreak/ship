# Task 38: Template editor: draft updates, undo/redo and read-only

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 37: Template editor: never lose an edit on save](37-editor-save-integrity.md)
- **Findings:** CR-133, CR-139, CR-132, CR-134, CR-141, CR-240
- **Effort:** M

## Goal

Batched draft actions clobber each other, redo survives edits, the delete key never deletes, built-in templates are editable in the drawer, and in-app navigation discards a dirty draft without asking.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-133 [Medium] Structural actions build the next draft from the render-captured `draft`, so batched calls clobber each other

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/builder/hooks/use-editor-actions.ts:123-161, components/builder/hooks/use-editor-actions.ts:173-206, components/builder/hooks/use-editor-actions.ts:261-330, components/template-editor/hooks/use-template-draft.ts:32, components/template-editor/hooks/use-template-draft.ts:125-151
- **What to do:** `removeNode`, `removeEdge`, `duplicateNode`, `addEdge` and `addInstance` still build `next` from the render-captured `draft` and call `apply(next)`, and `apply` only accepts a `Draft`, not an updater. Batched removals in one tick therefore clobber each other. Fix: let `apply` take `(cur) => next` (`setDraft` already supports updaters) and use it in every action, or add a batched `removeElements(nodeIds, edgeIds)`.

### CR-139 [Medium] Redo silently drops config edits made after an undo

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/hooks/use-template-draft.ts:125-170
- **What to do:** `redoStack` is cleared only inside the snapshot branch of `apply` (line 142). Coalesced or meta-only `apply` calls and every `patchNode` (all drawer config edits) leave redo intact and take no snapshot. So undo, then a config edit, then redo silently discards the edit. Fix: clear `redoStack` (and sync flags) on every non-undo/redo mutation, and route `patchNode` through the coalescing snapshot path.

### CR-132 [Medium] Keyboard delete on the canvas is non-functional (selection is never controlled)

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/components/BuilderFlow.tsx:82-149, components/template-editor/components/BuilderFlow.tsx:180
- **What to do:** `rfNodes` and `rfEdges` still carry selection only in `data.selected`, never the React Flow `selected` field, and `onNodesChange`/`onEdgesChange` drop `select` changes. So `deleteKeyCode` (still set) never deletes anything. Fix: keep a local `selectedIds` set fed from `select` changes and project it as `selected`, or set `deleteKeyCode={null}`.
- **Fix after:** CR-133 (this task)

### CR-134 [Medium] Read-only (built-in) templates are editable in the node drawer

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/builder/EditorNodeDrawer.tsx:106-117, components/builder/EditorPage.tsx:240-244, components/template-editor/NodeConfigurator.tsx:46
- **What to do:** `EditorNodeDrawer` still doesn't forward `readonly` to `NodeConfiguratorBody`, which has no such prop, and `EditorPage`'s `onPatch` still calls `machine.patchNode` unconditionally. So built-in templates are editable in the drawer, dirty the draft, and then fail to save. Fix: add `readOnly` to `NodeConfiguratorBody` and its tabs (disabled inputs) and guard `onPatch` with `if (readonly) return`.

### CR-141 [Medium] Unsaved-changes guard only covers tab close and the header back button

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** components/template-editor/hooks/use-template-draft.ts:194-203, components/builder/EditorPage.tsx:169-172, components/builder/EditorPage.tsx:290-297, components/builder/EditorHeader.tsx:98-100, components/builder/EditorError.tsx:31
- **What to do:** There is still no `popstate` or link interception: only `beforeunload` and the header back button check `dirty`. The header's gallery `Link`, browser Back/Forward and nav-bar links discard the draft with no prompt. Fix: add a shared `hooks/useNavigationGuard(dirty)` that intercepts in-app link clicks and pushes a sentinel history entry while dirty, and route in-page links through `onBack`.

### CR-240 [Low] Accessibility gaps: div-click node card, icon-only buttons without labels, tabs without ARIA

- **Status:** Open
- **Type:** Accessibility
- **Effort:** S
- **Where:** components/template-editor/components/BuilderNodeView.tsx:41-57, components/builder/EditorNotices.tsx:30-37, components/template-editor/NodeConfigurator.tsx:171-185
- **What to do:** The node card is still a `div onClick` with no role, tabIndex or key handler. The notice dismiss button is icon-only with `title` but no `aria-label`. The configurator tabs are still plain buttons with no tablist/tab roles and no `aria-selected`. Add role="button", tabIndex and an Enter/Space handler (or use a button), add `aria-label`, and switch to the shadcn `Tabs` primitive or the new `components/shared/TabStrip`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
