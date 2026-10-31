# Task 19: Fan-out rollup idempotency and floating promises

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 17: Atomic node claims and attempt identity](17-node-claim-and-attempts.md); [Task 12: Transaction API and atomic multi-writes](12-db-transactions.md)
- **Findings:** CR-009, CR-010, CR-061, CR-057, CR-058, CR-064
- **Effort:** L

## Goal

Fan-out rollup can double-publish and regress a finished parent, async work is dropped with `void`, step children assume one node, and auto-wrap creates a new hidden template on every expansion.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-009 [High] Fan-out rollup is not idempotent: it can publish twice and can regress an already-finished parent node

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:544, 561-575 (onChildFinished), 578-591 (checkRollup), 603-660 (onAllResolved); lib/engine/flow-engine.ts:286-312 (finishFanout)
- **What to do:** `checkRollup` is still fired with `void` from both `advance()` and `onChildFinished()`, has no in-flight guard, and `finishFanout` does an unconditional `UPDATE nodes SET status=…`, so a concurrent call can double-publish and a post-publish child retry can push an `approved` parent back to `awaiting_approval`. In addition, `onAllResolved` calls the engine's async `finishFanout` through an interface typed `void` (step-flow-manager.ts:145, 653), so `advanceFrom` errors after fan-out are unhandled rejections. Add a per-parent in-flight Set, make the terminal write `… AND status='running'` with an early return when `changes===0`, type `finishFanout` as `Promise<void>` and await it.

### CR-010 [High] `skipFanoutStep` drops the promise of async `skipStepFlow`: errors are unhandled and the API reports success

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:1618-1620; lib/engine/runtime/fanout/step-flow-manager.ts:938; app/api/flows/[id]/action/route.ts:65
- **What to do:** `skipFanoutStep` is still typed `void` and drops the promise from the async `skipStepFlow`, so the route answers `{ok:true}` immediately and validation throws become unhandled rejections. Make it `async … : Promise<void> { await stepFlows.skipStepFlow(…) }`. Enabling `@typescript-eslint/no-floating-promises` would also flag the `void checkRollup` / `finishFanout` drops in CR-009.

### CR-061 [Medium] Floating promises and mistyped async signatures in the fan-out path and `bg()`

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:145,325,544,574,653,706,896, lib/engine/runtime/split/split-manager.ts:436,650, lib/engine/flow-engine.ts:286,598-615, lib/engine/runtime/flow-reconciler.ts:312-329
- **What to do:** The engine port still declares `finishFanout(...): void` while `FlowEngine.finishFanout` is async, so `step-flow-manager.ts:653` drops its promise; `void this.advance(...)` still voids a non-promise, `checkRollup`/`runMergeBack`/`checkJoin` are fire-and-forget, and the catch blocks in `bg()` and the reconciler re-attach IIFE still write to the DB unguarded. Type the port `Promise<void>` and await it, funnel fire-and-forget work through one guarded helper, and enable `@typescript-eslint/no-floating-promises` (lint now runs).

### CR-057 [Medium] A double approve of a code step child starts a second merge loop that flips the merged step to `failed`

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:677-707,727, lib/engine/runtime/fanout/merge-arena.ts:56-58
- **What to do:** `approveChildStep` still only checks `status === "awaiting_approval"`, which stays true during merge-back, so a double approve launches a second `runMergeBack` that later fails fetching the deleted branch and flips the merged step to `failed`. Reject when `mergeArena.isMerging(childFlowId)`, a `step_merges` row is running, or `completed_by === 'merge'`; better, move the child to a distinct merging state atomically.
- **Fix after:** CR-054 ([Task 17](17-node-claim-and-attempts.md))

### CR-058 [Medium] Step-child code assumes one node per child flow, but explicit child templates can have several

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:685,879,913,923,931, lib/engine/runtime/flow-reconciler.ts:183,193, lib/engine/flow-engine.ts:1643-1647, lib/engine/runtime/split/split-manager.ts:660,673, lib/engine/templates/template-lint.ts:212-235
- **What to do:** Step-child code still uses `SELECT … FROM nodes WHERE flow_id=?` with no `node_key`/`ORDER BY` for approve, merge resume, and reconcile, while lint only forbids SDLC built-ins in `knob.child` templates and never checks the node count. Resolve the child's work node key once (store it in the trigger payload) and query by it, or enforce one-node children in template-lint.

### CR-064 [Medium] Auto-wrap template lookup can never match, so every fan-out expansion creates a new hidden template and inbound hook

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/runtime/fanout/step-flow-manager.ts:436-466, lib/engine/templates/template-store.ts:233-236,897, lib/engine/runtime/hook-store.ts:71-88
- **What to do:** `autoWrap` still searches `templateStore.list()` (which filters `hidden=0`) for a `hidden === 1` row, so every expansion creates a new hidden template and, through `syncTemplate`, a new inbound webhook with its own secret; the name-based key would also collide across same-labeled nodes. Key reuse on (source template id, node key, config hash) looked up with `includeHidden`, and skip hook provisioning for hidden templates.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
