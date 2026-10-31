# Task 13: One queryFn per query key

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 02: Make typecheck, lint and tests real gates](02-typecheck-and-build-gates.md)
- **Findings:** CR-005, CR-135, CR-121, CR-120
- **Effort:** M

## Goal

Several query keys are written by different `queryFn`s with different shapes and error semantics (repos, node contracts, settings, artifacts). Establish the `queryOptions` factory pattern from `docs/coding-patterns.md` and make each key have exactly one owner.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-005 [High] The template editor SSR seeds the shared `queryKeys.repos` cache with a different data shape

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/templates/[id]/page.tsx:52-55; loaders/templates.ts:35-40; components/builder/hooks/use-editor-queries.ts:74; components/settings/context.tsx:69; components/template-editor/WebhookPayloadDialog.tsx:148
- **What to do:** The editor SSR still seeds `queryKeys.repos` with the slim `EditorRepoChoice[]` (`{id,name,local_path}`), and Settings and WebhookPayloadDialog read the same key expecting full `Repo[]`. Give the editor slice its own key (for example `queryKeys.repoChoices`) in both the page and `use-editor-queries.ts`, or seed full `Repo[]` and narrow it with `select`.

### CR-135 [Medium] `queryKeys.nodeContracts(url)` (and `queryKeys.settings`) are shared by fetchers with different semantics

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/builder/hooks/use-instance-contracts.ts:39-60, components/builder/hooks/use-instance-contracts.ts:85-86, components/builder/hooks/use-instance-contracts.ts:145-146, components/template-editor/hooks/use-node-contract.ts:22-27, components/template-editor/hooks/use-node-contract.ts:38-39, components/templates/hooks/use-node-schema-contract.ts:33-35, components/template-editor/components/ConfigTab.tsx:80-82, components/templates/components/NodeConfigureDialog.tsx:70-72
- **What to do:** `queryKeys.nodeContracts(url)` is still written by three different `queryFn`s: `fetchContract` caches `null` on failure, `fetchNodeContract` throws, and `use-node-schema-contract` uses `fetchJson`. `queryKeys.settings` is likewise fetched by both `fetchSettings` and `fetchJson("/api/settings")`. Fix: export one `queryOptions` per key next to `queryKeys`, throw on failure, and handle `isError` in callers.

### CR-121 [Medium] `useArtifactFetcher` caches HTTP error bodies as artifacts and its "cache" never hits

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** hooks/use-artifact-fetcher.ts:14-28, components/flows/components/plan/components/masterPlanSection/MasterPlanSection.tsx:31-38
- **What to do:** `useArtifactFetcher` still returns `res.json()` regardless of status, so error bodies are cached as artifacts, and it uses `fetchQuery` with the default `staleTime: 0`, so the cache never hits. `MasterPlanSection` now writes the same `queryKeys.artifacts.detail(id)` key with a throwing `queryFn`, so two different semantics share one key. Fix: one shared `artifactQueryOptions(id)` using `fetchJson` with `staleTime: Infinity`, used by both, ideally inside the CR-120 hook.
- **Fix after:** CR-120 (this task)

### CR-120 [Medium] `ArtifactLoader` fetches in a raw `useEffect` with no error path: rejections hang on "Loading…" and stale content shows on id change

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** components/flows/panels/ArtifactViews.tsx:102-123 (consumers: ArtifactViews.tsx:37, AgentView.tsx:98, HttpView.tsx:60, ScriptView.tsx:63, BuildView.tsx:189), components/flows/panels/context.ts:25
- **What to do:** `ArtifactLoader` is still a raw `useEffect` + `useState` fetch with no `.catch`, so a failure hangs on "Loading…" forever, the previous artifact stays on screen when `id` changes, and loading is a bare spinner. The plan panel no longer uses it (`MasterPlanSection` has its own `useQuery` with skeleton, error and retry), but every other panel does. Fix: add a `useArtifact(id)` `useQuery` hook (`staleTime: Infinity`) with skeleton, error-with-retry and content states, then drop `fetchArtifact` from the panel context.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
