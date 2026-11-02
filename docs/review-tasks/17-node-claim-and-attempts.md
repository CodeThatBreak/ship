# Task 17: Atomic node claims and attempt identity

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 16: Late-write guard and run-row lifecycle](16-run-lifecycle-late-writes.md)
- **Findings:** CR-015, CR-054, CR-055, CR-056, CR-072, CR-066
- **Effort:** L

## Goal

Node ownership is decided by `status === 'running'` with check-then-act guards, so double sends, approve-during-refine and cancel-then-retry race. Add the atomic `claimNode` helper and an attempt token as described in `docs/coding-patterns.md`.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-015 [High] Runs have no attempt identity, so overlapping attempts on one node both treat it as theirs

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/harness/agent-runner.ts:176-177; lib/engine/nodes/shared/node-support.ts:80-89 (persistRun closes every running row); lib/engine/nodes/kinds/pipeline/pipeline-node.ts:348-349; lib/engine/flow-engine.ts:1726-1746 (sendChat has no running check)
- **What to do:** Guards still check only `nodes.status === 'running'`, and there is no attempt or run-sequence identity. After cancel then retry, or a chat sent mid-run, old runs or poll loops treat the node as theirs, and `persistRun` marks a still-streaming run row as `error`. Stamp an attempt token when a node goes `running`, pass it to `executeRun` and the pipeline loop, guard on token equality, and make `sendChat` refuse when the node is already running.
- **Fix after:** CR-014 ([Task 16](16-run-lifecycle-late-writes.md))

### CR-054 [Medium] Node start guards are check-then-act, and `startPlan`/`refinePlan`/`sendChat` have no guard at all

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/flow-engine.ts:1482-1520,1658-1692,1726-1746,1878-1892,1165, lib/engine/nodes/kinds/plan/plan-node.ts:220-241
- **What to do:** `startPlan`/`refinePlan` are gone; plan turns now go through `sendChat`, which still has no status guard, so a double send/second tab launches two concurrent plan turns (each sets `running` itself in `runPlanTurn`). `runNodeManual`, `retryNode` and `resumeNodeFromWebhook` still check status and then defer the real `running` write into `bg()`, leaving a check-then-act window. Add an atomic `claimNode(flowId, key, fromStatuses)` (`UPDATE … WHERE status IN (…)`, check `changes===1`) called synchronously before `bg()` in every trigger path.

### CR-055 [Medium] `approvePlan` does not check the plan node's status, so approving during a refine silently discards the refine

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:1336-1388, lib/engine/harness/agent-runner.ts:171-182
- **What to do:** `approvePlan` still approves the latest plan artifact and sets the node `approved` regardless of its status, so approving during an in-flight refine starts the build on the old version and the late-write guard then discards the refine. Require `awaiting_approval` (via the claim helper) and throw a typed conflict error otherwise.
- **Fix after:** CR-046 ([Task 09](09-typed-errors.md)), CR-054 (this task)

### CR-056 [Medium] `cancelNode` has no status guard and does not stop cloud runs

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:1698-1718
- **What to do:** `cancelNode` still has no status guard (a `done`/`approved`/`awaiting_approval` node is forced to `failed`), still only calls `cancel` for local mode so cloud agents keep running and billing, and never clears the `waitTimers` entry. Allow cancel only from `running`/`waiting` (pending via an explicit flag for the skip path), call `agentPortRegistry.forMode(flow.execution_mode).cancel(...)` for both modes, and delete the timer.

### CR-072 [Medium] `current_node` pointer lifecycle is inconsistent (never cleared, or cleared unconditionally)

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:598-614 (bg has no clear), 1658-1692 (retryNode sets the pointer at 1673, never clears it), 1726-1746 (sendChat clears unconditionally on success at 1744, never on failure), 788-791 (assertPlanEditable blocks on the pointer); lib/engine/nodes/chains/sdlc-chain.ts:103,157,182,202 (unconditional null); lib/engine/runtime/flow-reconciler.ts:59-67
- **What to do:** Plan runs now go through `sendChat`. A failed plan chat therefore leaves `current_node` set, and checklist edits stay blocked until the throttled reconcile. A successful chat can also wipe a pointer that another stage now owns. Fix: in `bg()`'s `finally`, call `clearCurrentIf(flowId, nodeKey)` when `nodeKey` is set, and remove the ad-hoc `setCurrentNode(flowId, null)` calls.

### CR-066 [Medium] Flow `delete()` does not stop in-flight work or clear in-memory engine state

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/flow-engine.ts:546-567
- **What to do:** `delete()` still only removes worktrees and then deletes table rows per flow; it does not cancel running/waiting nodes or in-flight merges, clear `waitTimers`/in-memory state, or run the deletes in one transaction, so background work keeps writing to a deleted flow. Cancel every running/waiting node of the flow and its children first, refuse while `mergeArena.isMerging(child)`, drop timer entries, and wrap the deletes in one transaction.
- **Fix after:** CR-012 ([Task 12](12-db-transactions.md)), CR-056 (this task)

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
