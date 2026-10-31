# Task 25: Durable waits and a well-behaved poller

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 17: Atomic node claims and attempt identity](17-node-claim-and-attempts.md)
- **Findings:** CR-006, CR-060, CR-045, CR-193, CR-194
- **Effort:** M
- **Needs approval:** Persisting `wait_until` on the node row (CR-006) is a schema change. Ask first, or ship the startup re-arm pass without the schema change.

## Goal

Wait timers live only in memory, poller ticks overlap and throw unhandled, the poller starts as a side effect of GET requests, schedules drift, and long-lived maps grow unbounded.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-006 [High] Timer and comment-debounce waits are memory-only, so a restart strands `waiting` nodes forever

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/flow-engine.ts:1290-1295 (armNodeWait), 1325-1333 (bounceCommentWaits), 1895-1925 (waitTimers / processWaitTimers); lib/engine/runtime/flow-poller.ts:26-41 (start: no re-arm pass)
- **What to do:** Timer and comment-debounce deadlines still live only in the in-memory `waitTimers` Map, and nothing re-arms `waiting` nodes after a restart. The comment at 1895-1900 claims a restart re-arms "on the next join evaluation", but no code does that. Persist `wait_until` on the node row (needs schema approval and a row-mapper update), or at minimum add a startup pass in `FlowPoller.start()` that re-arms every `waiting` timer/comments node from `updated_at` plus its configured minutes.

### CR-060 [Medium] Poller ticks can overlap, and non-MR steps of the tick run outside any try/catch

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/flow-poller.ts:40,43-72
- **What to do:** `setInterval(() => void this.tick(), …)` still allows overlapping ticks, and `processWaitTimers()`/`processTemplateSchedules()` still run outside any try/catch, so a throw aborts the tick as an unhandled rejection. Add a `ticking` re-entrancy guard (or self-rescheduling `setTimeout`) and wrap each tick phase in its own logged try/catch.

### CR-045 [Medium] GET handlers and server loaders start the poller and run the reconciler as side effects

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** app/api/flows/route.ts:8,13, app/api/flows/[id]/route.ts:9,14, app/api/flows/[id]/events/route.ts:11, loaders/flows.ts:25,28,42, app/api/hooks/[id]/route.ts:63, app/api/webhooks/gitlab/route.ts:33
- **What to do:** GET handlers and loaders still call `flowPoller.start()` and fire `reconciler.reconcileFlow(id)` (for any id, every 3 s from the events poll) with errors swallowed by `.catch(() => {})`; there is still no `instrumentation.ts`. Start the poller once from `instrumentation.ts` `register()`, move reconcile onto the poller tick or an explicit POST, and log reconcile failures.

### CR-193 [Low] Schedule triggers drift and are interval-only

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/flow-poller.ts:81-103 (92-93); lib/engine/templates/template-store.ts:895-909
- **What to do:** The next fire is still computed as `now + interval`, so each tick's lateness accumulates. Schedules remain interval-only, with no cron or timezone. Advance from `due` and skip missed slots (`due + ceil((now-due)/iv)*iv`), and add cron plus timezone to the trigger schema if wall-clock schedules are needed.

### CR-194 [Low] Unbounded in-memory maps in long-lived singletons

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** lib/cache.ts:9-12,17-22; app/api/tasks/live/route.ts:21; lib/engine/runtime/flow-reconciler.ts:40,44; lib/engine/runtime/flow-poller.ts:23
- **What to do:** `TtlCache` still never evicts, and its keys include free search text, so it grows without bound. `Reconciler.lastReconcile`/`flaggedOrphans` and `FlowPoller.lastCommentCount` are never pruned. The live-task route's stale-on-error fallback reads expired entries through `entry()`, so deleting on expired read would break it. Use a size cap with oldest-first eviction or a periodic sweep of entries much older than the TTL instead, and prune the engine maps on flow delete or when a flow goes inactive.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
