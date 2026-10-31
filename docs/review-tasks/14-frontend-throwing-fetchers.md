# Task 14: Remove error-swallowing fetchers

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 13: One queryFn per query key](13-frontend-query-ownership.md)
- **Findings:** CR-036, CR-143
- **Effort:** M

## Goal

Settings and the template editor use local fetchers that turn HTTP errors into fallback values, so TanStack Query never reaches `isError` and the UI shows false empty states. Switch them to the throwing `@/hooks/fetch-json` helpers and render error and retry states.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-036 [High] Settings fetchers swallow every error, so error states can't render and the UI shows false empty states

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** components/settings/queries.ts:9-31, components/settings/context.tsx:68-70,94-110, app/(workspace)/settings/page.tsx:76-84, components/settings/integrations/HarnessTab.tsx:35,59-65, components/settings/repos/ReposSection.tsx:78
- **What to do:** The settings-local `fetchJson(url, fallback)` still swallows HTTP/network errors, so the three provider queries never enter `isError`; a failed `/api/repos` shows "No repos registered yet", a failed `/api/settings` shows "No harness connected" or "Settings are unavailable" with no retry. Switch the three queries to the throwing `@/hooks/fetch-json`, expose `isError`/`refetch` per query from `SettingsProvider`, render error+Retry before empty states, and rename the resilient helper (only `useDetectedPolicy` needs it).

### CR-143 [Medium] Fetchers swallow errors, so error states can never render

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** components/builder/hooks/use-editor-queries.ts:46-63, components/builder/EditorPage.tsx:116-124, components/template-editor/WebhookPayloadDialog.tsx:52-62, components/template-editor/WebhookPayloadDialog.tsx:84-94, components/template-editor/WebhookPayloadDialog.tsx:380-383, components/settings/queries.ts:10-31, components/template-editor/components/ConfigTab.tsx:80-95
- **What to do:** `fetchTaskProviders` and `fetchRepoChoices` still `.catch(() => null)` with no `res.ok` check. The webhook dialog's local `fetchJson` and the settings `fetchJson`/`fetchSettings`/`fetchRepos`/`fetchGitHosts` still return fallbacks, so the dialog's `failed` alert and ConfigTab's `secretsQuery.isError` branch can never render. EditorPage still treats pending providers and repos as `[]`, with no skeleton. Fix: use the throwing `@/hooks/fetch-json` `fetchJson`, then render `isPending` skeletons and `isError` retry in the trigger/repo pickers.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
