# Task 53: App shell out of `shared/`, settings tab de-duplication

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 52: Shared UI components and one `cn()`](52-shared-ui-components.md); [Task 42: Settings forms: detected values, paths, deletes, labels](42-settings-forms.md)
- **Findings:** CR-244, CR-245, CR-248, CR-249
- **Effort:** M

## Goal

The sidebar (with app routes) lives in `components/shared/` and highlights nothing on detail routes, and GitTab and TaskTab are near-duplicates with three identical modal chromes.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-244 [Low] Sidebar active state uses exact pathname match, so nested routes highlight nothing

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/shared/AppSidebar.tsx:81
- **What to do:** `const active = pathname === nav.pathname` is unchanged, so on detail routes (for example /flows/<id> or /templates/<id>) no sidebar item is highlighted. Use longest-prefix matching (`pathname === href || pathname.startsWith(href + "/")`, picking the most specific match), with `/` special-cased.

### CR-245 [Low] `components/shared` holds app-specific code (sidebar nav routes, "Search tasks…" default)

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/shared/AppSidebar.tsx:35-53,70,99, components/shared/FilterPicker.tsx:98, app/(workspace)/page.tsx:38
- **What to do:** AppSidebar still hardcodes the DevFlow route table, product name and "Local workspace" inside `components/shared/`, and FilterPicker still defaults its placeholder to "Search tasks…". Move AppSidebar to an app-shell folder (for example components/layout/) with routes in constants/routes.ts, reuse those route constants in links, and give FilterPicker a neutral default.

### CR-248 [Low] GitTab / TaskTab are near-duplicates, and three identical modal chromes exist

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** components/settings/integrations/GitTab.tsx:32-105 (166 lines), components/settings/integrations/TaskTab.tsx:32-104 (173 lines), components/settings/integrations/components/ConnectModal.tsx:10-39, components/settings/repos/components/RepoModal.tsx:10-40, components/settings/general/components/SecretModal.tsx:10-40
- **What to do:** GitTab and TaskTab are still near-duplicates in hook wiring, list, test/remove and submit logic, and the three modal chromes still repeat the same Cancel + submit footer. There is no `FormModal` yet. Add components/shared/FormModal.tsx (props for icon, submitLabel and width) and a shared `InstanceList` container, so each tab supplies only its form fields.
- **Fix after:** CR-243 ([Task 52](52-shared-ui-components.md))

### CR-249 [Low] Callbacks created inside `.map()` for row components

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/settings/repos/ReposSection.tsx:81-89, components/settings/integrations/GitTab.tsx:99-101, components/settings/integrations/TaskTab.tsx:98-100, components/settings/integrations/HarnessTab.tsx:76
- **What to do:** Row callbacks (`onEdit={() => openEdit(r)}`, `onTest={() => runTest(i.id)}`, `onDelete={() => remove.mutate(i.id)}`) are still created inside `.map()`. Pass the id plus stable `onEdit(id)` / `onDelete(id)` / `onTest(id)` handlers and bind them inside the row, following CustomNodesSection.tsx:111-112 / SecretRow.
- **Fix after:** CR-248 (this task)

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
