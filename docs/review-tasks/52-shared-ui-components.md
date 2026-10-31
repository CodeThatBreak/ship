# Task 52: Shared UI components and one `cn()`

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 04: Enforce the client/server and feature-barrel boundaries](04-client-server-boundaries.md)
- **Findings:** CR-174, CR-231, CR-243, CR-252, CR-259, CR-251, CR-156
- **Effort:** M

## Goal

Eight copies of the route error boundary, three `TableSkeleton`s, hand-rolled empty states, a custom modal inside `components/ui/`, a 436-line `DataTable`, and two competing `cn()` implementations.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-174 [Low] Six identical error boundaries and three copies of `TableSkeleton`

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** app/error.tsx; app/(workspace)/error.tsx; app/(workspace)/flows/error.tsx; app/(workspace)/settings/error.tsx; app/(workspace)/templates/error.tsx; app/(workspace)/templates/nodes/error.tsx; app/flows/[id]/error.tsx; app/templates/[id]/error.tsx; TableSkeleton in app/(workspace)/flows/loading.tsx:4, app/(workspace)/templates/loading.tsx:4, app/(workspace)/templates/nodes/loading.tsx:4
- **What to do:** There are still eight near-identical error boundaries (they differ only in log tag and message) and three local copies of `TableSkeleton`, and `components/shared/` has neither. Add `components/shared/RouteError.tsx` and `components/shared/TableSkeleton.tsx`, and make each `error.tsx`/`loading.tsx` a thin wrapper around them.

### CR-231 [Low] Empty-state markup duplicated instead of reusing `PanelEmptyState`; generic components not in `components/shared/`

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/flows/panels/AgentView.tsx:105-108; components/flows/panels/ArtifactViews.tsx:40-43; components/flows/panels/BuildView.tsx:194-197; components/flows/panels/ReviewView.tsx:131-134; components/flows/components/plan/components/PlanEmptyHint.tsx:9; components/flows/panels/PanelEmptyState.tsx; components/chat/ChatFeedError.tsx
- **What to do:** Four panels (plus the new PlanEmptyHint) still hand-roll the icon-plus-muted-text empty block with drifting `py-10`/`py-16`, while HttpView, ScriptView and DecisionView use `PanelEmptyState`. `PanelEmptyState` and `ChatFeedError` are still in feature folders, not `components/shared/`. Fix: use `PanelEmptyState` everywhere and promote it (as `EmptyHint`) and a generic `InlineError` to `components/shared/`.

### CR-243 [Low] `components/ui/modal.tsx` is a custom wrapper inside the shadcn-only folder

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/ui/modal.tsx:1-72 (import at :10, "Radix" comment at :12-15); consumers components/tasks/BuildModal.tsx, components/settings/integrations/components/ConnectModal.tsx, components/settings/repos/components/RepoModal.tsx, components/settings/general/components/SecretModal.tsx, components/chat/prompt-modal/PromptModal.tsx
- **What to do:** The custom `Modal` adapter, which preserves the old hand-rolled API, still lives in the shadcn-only `components/ui/` folder, still imports `../../lib/utils` (the ui lint rule blocks `@/lib/**` but not relative paths), and still says "Radix". Move it to components/shared/Modal.tsx, export it from the shared barrel, update the 5 importers, and fix the import and comment.
- **Fix after:** CR-259 (this task)

### CR-252 [Low] `DataTable.tsx` is 436 lines with three components

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** components/shared/DataTable.tsx:84-335,338-415,419-436
- **What to do:** The file is still 436 lines and still defines `DataTable`, `ActionsCell` and a hand-rolled `ChevronsUpDown`. Split it into a components/shared/dataTable/ folder (DataTable, ActionsCell, pagination, skeleton rows, TreeCell; the folder name is lowercase per §2.9) and use lucide's `ChevronsUpDown`.

### CR-259 [Low] Two competing `cn()` implementations are used side by side, and `components.json` is out of sync with both

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** package.json (deps `cn`, `clsx`, `tailwind-merge`), lib/utils.ts, components.json:15,20, components/ui/modal.tsx:10, components/shared/AppSidebar.tsx:15, components/shared/FilterPicker.tsx:17, components/tasks/TasksView.tsx, components/tasks/TaskBadges.tsx
- **What to do:** Two `cn` engines are still used side by side: 33 files import from the `cn` package and 33 from `@/lib/utils` (lib/utils is allowlisted for client code in eslint.config.mjs). components.json still points `utils` at `@/lib/utils` while the primitives use `cn`, and the `ai-elements` alias still targets a non-existent folder. Pick one implementation, codemod the imports, repoint components.json, drop the unused dependencies, and remove the alias (plus the lint allowlist entry if lib/utils is dropped).

### CR-251 [Low] `Markdown` memo comparator ignores every prop except `children`

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/shared/Markdown.tsx:136-150
- **What to do:** `React.memo(..., (prev, next) => prev.children === next.children)` still ignores changes to `className`, `id` and handlers. Drop the custom comparator so the default shallow compare applies, or compare `children` and `className` as well.

### CR-156 [Medium] DataTable sortable headers are mouse-only; action link nests a button inside an anchor

- **Status:** Open
- **Type:** Accessibility
- **Effort:** S
- **Where:** components/shared/DataTable.tsx:200-204, components/shared/DataTable.tsx:315-330, components/shared/DataTable.tsx:355-357, components/shared/DataTable.tsx:393-394
- **What to do:** Sortable headers are still `onClick` on `TableHead`, with no button, `tabIndex` or `aria-sort`. The `href` action still nests `<Button>` inside `<a>`, the pagination icon buttons have no `aria-label`, and overflow items are keyed by `action.label`. Fix: render a `<button type="button">` in sortable headers and set `aria-sort`, use `<Button render={<a href=… />}>`, add Previous/Next page labels, and key menu items by index plus label.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
