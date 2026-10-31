# Task 41: Settings: per-page data and scoped errors

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 14: Remove error-swallowing fetchers](14-frontend-throwing-fetchers.md)
- **Findings:** CR-038, CR-151, CR-152, CR-255, CR-052, CR-256
- **Effort:** M

## Goal

Settings saves fail silently, invalidations miss the provider's queries, one sticky layout-level error leaks across pages, and every page waits on three queries. Move to server-prefetched, per-resource queries.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-038 [High] `saveSettings` silently drops failed PATCHes; local-agent toggles (sandbox / --force) fail without feedback

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/settings/context.tsx:81-92, components/settings/integrations/hooks/use-local-agent-options.ts:17-32
- **What to do:** `saveSettings` still returns silently on `!res.ok`, and `useLocalAgentOptions` fires it with `void ….finally()`, so a failed Sandbox/--force toggle gives no feedback (network errors become unhandled rejections). Delete `saveSettings` from the context, use `usePatchSettings()` in the hook (derive in-flight field from `mutation.variables`/`isPending`), and thread the tab's `onError` into the mutation.

### CR-151 [Medium] Connecting or removing an integration doesn't invalidate settings status, so General's status strip goes stale

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/settings/integrations/hooks/use-instances.ts:91-117, components/settings/context.tsx:68-70
- **What to do:** `useConnectInstance` and `useRemoveInstance` still invalidate only `queryKeys.integrations.instances(...)`. The layout-level `SettingsProvider`'s `settings` and `gitHosts` queries (the `status.gitHosts`/`status.taskProviders` flags in General's status strip) stay stale until a focus refetch. Fix: in both `onSuccess` handlers also invalidate `queryKeys.settings`, plus `queryKeys.gitHosts` (HOST surface) or `queryKeys.taskProviders` (TASK surface).

### CR-152 [Medium] One global settings error string leaks across sub-routes and is never cleared

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/settings/context.tsx:66, components/settings/context.tsx:104-105, components/settings/repos/ReposSection.tsx:59-63, components/settings/general/components/CustomNodesSection.tsx:66-81, components/settings/integrations/HarnessTab.tsx:48-51
- **What to do:** `error` is still a single layout-level `useState`. Every section reports through `onError(e.message)`, and no code path calls `setError(null)`, so one failure sticks across sub-routes and survives later successful saves. Fix: scope errors per page or per modal (use `mutation.error`), or at minimum clear them in each `onSuccess` and on pathname change.

### CR-255 [Low] SettingsProvider fetches unused git-hosts data and gates every sub-route on all three queries

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** components/settings/context.tsx:7,47,52,70-79,94,102,106, components/settings/queries.ts:21,30
- **What to do:** `/api/git-hosts` is still fetched on every settings visit, though nothing outside context.tsx reads `hosts` or `reload` (grep-verified). `loading` still ORs all three `isPending`s, so every page waits for the slow `/api/settings` probe. Remove `hosts`, `reload` and `fetchGitHosts`, and replace the context with per-resource query hooks so each page waits only on its own data.

### CR-052 [Medium] The Settings pages are client components that fetch their data on the client

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** app/(workspace)/settings/page.tsx:1,11-50, app/(workspace)/settings/integrations/page.tsx:1, app/(workspace)/settings/repositories/page.tsx:1, app/(workspace)/settings/layout.tsx:1-6, app/(workspace)/settings/loading.tsx
- **What to do:** All three settings pages are still `"use client"` and get their data client-side via `SettingsProvider`; there is no `loaders/settings.ts`, and `GeneralSkeleton` duplicates `settings/loading.tsx`. Add a settings loader, make pages Server Components that prefetch into `HydrationBoundary`, and move the interactive bodies into client islands that reuse the `loading.tsx` skeleton.
- **Fix after:** CR-036 ([Task 14](14-frontend-throwing-fetchers.md))

### CR-256 [Low] `createInstance` returns `null` cast as `InstanceRow`

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/settings/integrations/hooks/use-instances.ts:46-47
- **What to do:** `return body.instance ?? (null as unknown as InstanceRow)` is unchanged. Throw a typed error when `instance` is missing (per the §2.9 early-guard rule), or type the return as `InstanceRow | null`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
