# Task 42: Settings forms: detected values, paths, deletes, labels

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 41: Settings: per-page data and scoped errors](41-settings-data-and-errors.md)
- **Findings:** CR-035, CR-147, CR-149, CR-150, CR-250
- **Effort:** M

## Goal

Auto-detected repo policy is saved as explicit overrides, tilde collapsing rewrites `local_path`, one-click deletes have no confirm or pending state, failed deletes and tests are silent, and form controls are unlabeled.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-035 [High] Repo form persists auto-detected policy as explicit per-repo overrides

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/settings/repos/ReposSection.tsx:29-37, components/settings/repos/hooks/use-repo-form.ts:48-56, components/settings/repos/hooks/use-detected-policy.ts:19-29
- **What to do:** The effect still copies `/api/repos/detect` output into empty `install_command`/`sync_paths` whenever the editor is open, so saving an edit pins detected values as per-repo overrides and a cleared field gets refilled. Show detected values as placeholder/help text read during render, send only user-typed fields, disable the detect query when `local_path` is empty, and drop the effect + `applyDetected`.

### CR-147 [Medium] `tildePath` collapses *any* user's home (and `/Users/Shared`) to `~`, so edit-and-save rewrites `local_path`

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/settings/repos/paths.ts:7-9, components/settings/repos/hooks/use-repo-form.ts:20, components/settings/repos/components/RepoCard.tsx:48, app/api/repos/[id]/route.ts:28-30
- **What to do:** `tildePath` still collapses any `/Users/<x>` or `/home/<x>` prefix to `~`, and `formFromRepo` feeds that collapsed path into the editable field. On save, the API expands `~` against the server `HOME`, so editing a repo at `/Users/Shared/...` silently rewrites `local_path`. Fix: keep the raw stored path in the form and tilde-collapse only for display, ideally against the real home returned by the API.

### CR-149 [Medium] Destructive deletes fire on one click with no confirmation (repos, integration instances, Cursor key)

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** components/settings/repos/ReposSection.tsx:85-87, components/settings/repos/components/RepoCard.tsx:70-83, components/settings/integrations/GitTab.tsx:101, components/settings/integrations/TaskTab.tsx:100, components/settings/integrations/HarnessTab.tsx:76, components/settings/integrations/components/InstanceCard.tsx:78
- **What to do:** The trash buttons still DELETE a repo or an instance (with its stored token), or clear the Cursor API key, on one click. There is no confirm and no disabled-while-pending state, so double clicks send duplicate DELETEs. Fix: hold a `pendingDelete` id per container, render the shared `ConfirmDeleteDialog` with `busy={remove.isPending}`, and pass a `deleting` prop to `RepoCard` and `InstanceCard`.

### CR-150 [Medium] Mutation failures swallowed: instance remove, connection test, and the task repo-pin PATCH

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** components/settings/integrations/GitTab.tsx:67-72, components/settings/integrations/GitTab.tsx:101, components/settings/integrations/TaskTab.tsx:67-71, components/settings/integrations/TaskTab.tsx:100, components/settings/integrations/hooks/use-instances.ts:60-71
- **What to do:** `remove.mutate(i.id)` still has no `onError`, so a failed delete is silent. `callTestInstance` still awaits a bare `fetch` that can reject, and `runTest` has no `onError`, so an offline test just stops spinning with no badge. Fix: add `onError: (e) => onError(e.message)` to both removes, and wrap the test `fetch` in try/catch that returns `{ ok: false, detail }`.

### CR-250 [Low] Unlabeled form controls in settings and the shared FilterPicker

- **Status:** Open
- **Type:** Accessibility
- **Effort:** S
- **Where:** components/settings/general/components/HttpAllowlist.tsx:23-30, components/settings/general/components/ModeCascade.tsx:33-37, components/settings/general/components/DefaultModelFields.tsx:21-25, components/settings/integrations/GitTab.tsx:115-124, components/settings/integrations/TaskTab.tsx:114-123, components/settings/integrations/HarnessTab.tsx:100-107, components/shared/FilterPicker.tsx:95-100
- **What to do:** Labels are still plain `<div>`s, or a `FieldLabel` without `htmlFor` next to a `SelectTrigger` with no `id` (ProviderSelect / HostingSelect take no id prop), and the FilterPicker input has only a placeholder. Use `<FieldLabel htmlFor>` with matching ids threaded through the selects, and add `aria-label` to the FilterPicker input.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
