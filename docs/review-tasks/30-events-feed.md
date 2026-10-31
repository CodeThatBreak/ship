# Task 30: Event feed ordering, cursor and tail loading

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 13: One queryFn per query key](13-frontend-query-ownership.md)
- **Findings:** CR-026, CR-119, CR-108
- **Effort:** M

## Goal

Remounting the cockpit duplicates or reorders events, the cursor can skip same-millisecond events, and long flows take tens of seconds to show recent activity.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-026 [High] Event stream replays the cached batch and refetches from cursor "" on remount, so events are duplicated or out of order

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/flows/cockpit/hooks/use-flow-events.ts:20-46; components/chat/ChatFeed.tsx (e${ev.id} keys)
- **What to do:** The hook is unchanged: the buffer (`useState`) and cursor (`useRef("")`) are per-mount while the batch stays cached under `queryKeys.flows.events(flowId)`. A remount therefore appends the cached newest batch, then refetches from cursor "" and appends history after it, producing out-of-order and duplicated events. The cursor is also mutated inside `queryFn`. Keep the merged, de-duplicated, capped array in the query cache (the `queryFn` reads the previous data and fetches `after=<last id>`), or remove the query on unmount and de-dupe by id; drop the `useEffect` append.

### CR-119 [Medium] Initial event history loads oldest-first, 200 per 3 s poll, and each page invalidates the flow snapshot

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/flows/cockpit/hooks/use-flow-events.ts:25-43, components/flows/cockpit/FlowCockpit.tsx:41-45, app/api/flows/[id]/events/route.ts:13-18
- **What to do:** The hook still starts at `after=""`, gets 200 events oldest-first per 3-second tick, and has no tail mode, so a long flow takes tens of seconds to show recent activity. Every page changes `lastEventId`, which invalidates `flows.detail` again. Fix: fetch the tail on the first load (a `tail`/`desc` mode capped at `EVENTS_BUFFER_MAX`), or keep fetching while pages come back full, and invalidate the flow detail only once caught up.
- **Fix after:** CR-108 (this task)

### CR-108 [Medium] Event ids are not monotonic within a millisecond, so the events cursor (`id > after`) can silently skip events

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/db/index.ts:853-855, app/api/flows/[id]/events/route.ts:13-18
- **What to do:** `uid()` is still `Date.now().toString(36) + random`, and the events route still filters `id > ?` while ordering by `created_at, id`, so two events in the same millisecond can be skipped for good. Fix: a monotonic id generator (a per-instance same-millisecond counter), or page on `rowid` or a `(created_at, id)` tuple cursor.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
