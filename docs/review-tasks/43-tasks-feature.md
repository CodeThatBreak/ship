# Task 43: Tasks feed: errors, refresh and start-build

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 14: Remove error-swallowing fetchers](14-frontend-throwing-fetchers.md)
- **Findings:** CR-037, CR-148, CR-153
- **Effort:** S

## Goal

A failed provider fetch renders as "No tasks match", a refresh can write results into the wrong filter's cache, and start-build ignores failed requests.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-037 [High] Tasks feed ignores query errors, so a failed provider fetch renders as "No tasks match the current filters"

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** components/tasks/hooks/use-live-tasks.ts:35-39,52-69, components/tasks/TasksView.tsx:53,111,137-148
- **What to do:** `useLiveTasks` still never returns `query.isError`/`query.error`; only `staleError` (payload.error) and the force-refresh mutation error reach `TasksView`, so a 502/500 with no cached data renders "No tasks match the current filters" with no banner or Retry. Return `queryError: query.error?.message`, fold it into `error` in TasksView, and keep rows visible on background failures.

### CR-148 [Medium] Force-refresh race writes one filter-set's results into another filter-set's cache

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/tasks/hooks/use-live-tasks.ts:41-50, components/tasks/hooks/use-live-tasks.ts:67
- **What to do:** The refresh mutation still closes over `params` in `mutationFn` and writes to the render-bound `queryKey` in `onSuccess`. A filter change mid-refresh therefore writes the old filter's results into the new filter's cache. `refresh.error` is reset only on the next forced refresh, so the error banner persists across filter changes. Fix: pass `params` as the mutation variable, `setQueryData(queryKeys.tasks.live(vars))`, and `refresh.reset()` when `params` changes.

### CR-153 [Medium] Build start chain ignores the repo-pin PATCH result and parses non-JSON error bodies

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/tasks/hooks/use-start-build.ts:32-55
- **What to do:** The repo-pin `PATCH /api/tasks/:id` result is still never checked, so the flow is created even if pinning failed. Materialize and create-flow still do `.then((r) => r.json())` with no `res.ok`, so HTML 5xx bodies surface as a `SyntaxError`. Fix: use `postJson` from `@/hooks/fetch-json` for both POSTs, and add a throwing `patchJson` (or check `res.ok`) for the PATCH.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
