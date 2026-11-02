# Task 37: Template editor: never lose an edit on save

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 14: Remove error-swallowing fetchers](14-frontend-throwing-fetchers.md)
- **Findings:** CR-029, CR-030, CR-136, CR-140, CR-142
- **Effort:** M

## Goal

Edits made during a save are discarded, 5xx responses report "Draft saved", stale validation can overwrite newer results, the last layout drag is dropped on unmount, and the gallery shows stale rows after save.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-029 [High] Edits made while a save is in flight (and pending debounced prompt writes) are silently discarded

- **Status:** Fixed (Task 37)
- **Type:** Bug
- **Effort:** M
- **Where:** components/builder/hooks/use-editor-save.ts:46-115; components/template-editor/PromptTab.tsx:41-45; components/template-editor/hooks/use-debounced-callback.ts:17-47
- **What to do:** `runSave` still snapshots `machine.draft`, awaits validate, PATCH and refetch, then unconditionally `setDirty(false)` and `replaceDraft(…)`, discarding edits typed in the meantime. The debounced prompt write still captures a stale `node.config` and exposes no `flush()` (it flushes only on unmount). Flush pending debounced writes before snapshotting, compare a draft revision counter before `replaceDraft`/clearing dirty, and make debounced writers use a functional node patch.
- **Fix after:** CR-030 (this task)

### CR-030 [High] Save reports success for 5xx, 413 and other non-400 failures; network errors are unhandled

- **Status:** Fixed (Task 37)
- **Type:** Bug
- **Effort:** S
- **Where:** components/builder/hooks/use-editor-save.ts:92-114
- **What to do:** Success is still judged by `res.status !== 400 && !r?.error`, so 5xx or 413 responses with a non-JSON body show "Draft saved" and clear dirty. The block is still `try/finally` with no `catch`, so network or validate rejections are unhandled. Check `!res.ok`, add a `catch` that sets the error, ideally by moving the save into a TanStack `useMutation`.

### CR-136 [Medium] Live validation results can arrive out of order and re-apply after save

- **Status:** Fixed (Task 37)
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/hooks/use-template-validation.ts:86-117
- **What to do:** In-flight validate requests still have no abort or sequence guard, so a slow older response can overwrite newer results or `clear()`. Fetch and parse failures still become `[]`, so the pre-save gate in `use-editor-save` passes silently. Fix: keep a `seq` ref and abort the previous controller (with `clear()` cancelling both), or move to a `useQuery` on a debounced draft hash; surface a failure as an "unable to validate" state.

### CR-140 [Medium] Revisiting the editor seeds the draft and positions from stale cache; layout autosave can overwrite newer positions

- **Status:** Fixed (Task 37)
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/hooks/use-node-positions.ts:35, components/template-editor/hooks/use-node-positions.ts:48-53, components/template-editor/hooks/use-node-positions.ts:55-69, components/template-editor/hooks/use-template-draft.ts:51, components/builder/EditorPage.tsx:70-80
- **What to do:** Draft and positions still seed from `useState(initial)` at mount only, and are re-adopted only after a structural Save (`use-editor-save.ts:102-107`). The positions PATCH never writes `queryKeys.templates.detail`, so revisiting within gcTime shows stale cached positions, and the next drag PATCHes them over the server copy. Unmount still `clearTimeout`s the pending 700 ms save, which drops the last drag. Fix: `setQueryData` the detail after the PATCH, flush the save with `keepalive` on unmount, and key the editor or reset when a newer `dataUpdatedAt` arrives while the draft isn't dirty.

### CR-142 [Medium] Gallery cache is not invalidated after create or save, and fresh server props are ignored

- **Status:** Fixed (Task 37)
- **Type:** Bug
- **Effort:** S
- **Where:** components/templates/TemplateGallery.tsx:105-109, components/templates/TemplateGallery.tsx:165, components/templates/hooks/use-template-list.ts:22-29, components/templates/hooks/use-node-list.ts:22-29, components/builder/hooks/use-editor-save.ts:100-108
- **What to do:** `createMutation` still navigates without invalidating `queryKeys.templatesGallery`, and an editor save or rename refetches only the detail. Both list hooks still use `initialData` plus `initialDataUpdatedAt: Date.now()`, which is ignored when a cache entry exists, so the gallery shows stale rows. `pageError` is never cleared. Fix: invalidate `templatesGallery` on create and editor save, hydrate the gallery with prefetch plus `HydrationBoundary`, and clear `pageError` when each mutation starts.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
