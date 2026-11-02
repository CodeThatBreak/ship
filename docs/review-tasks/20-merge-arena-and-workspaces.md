# Task 20: Merge arena locking and workspace directories

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 19: Fan-out rollup idempotency and floating promises](19-fanout-rollup-and-promises.md)
- **Findings:** CR-008, CR-059, CR-106, CR-107
- **Effort:** M

## Goal

The merge lock is per integration branch while the arena directory is per parent, the arena is a plain module singleton, and the clone and worktree roots share `workspaces/<flowId>`. Make locking and directories match.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-008 [High] Merge-arena lock is per integration branch, but all branches of a parent share one working directory

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/fanout/merge-arena.ts:74-85 (withLock), 88-98 (ensureWorkspace), 132 (lock key), 144-155 (merge under lock), 272-281 (deleteStepBranch runs outside any lock)
- **What to do:** The lock key is still `${parentFlowId}:${integrationBranch}`, while the arena directory is one `${parentFlowId}-arena` per parent, and multi-branch plans still produce several integration branches (`integrationBranchFor(…, stepRow.branch)`). Concurrent approvals in different branch groups can therefore abort, reset or check out over each other, and the lazy clone races too. Lock on `parentFlowId` (including the lazy clone and `deleteStepBranch`), or use one arena or worktree per integration branch.

### CR-059 [Medium] `mergeArena` is a plain module singleton even though it holds process state that reconcile relies on

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/fanout/merge-arena.ts:296, lib/engine/runtime/flow-reconciler.ts:154
- **What to do:** `export const mergeArena = new MergeArena()` is still a plain module singleton holding `locks` and `inFlight`, while the reconciler (itself a `processSingleton`) relies on `isMerging()`; under `next dev` duplicated bundles can double-run merges. Wrap with `processSingleton("mergeArena", () => new MergeArena())`.

### CR-106 [Medium] Per-flow clone dir and per-flow worktree dir are the same path (`workspaces/<flowId>`)

- **Status:** Fixed
- **Type:** Bug
- **Effort:** M
- **Where:** lib/git/local.ts:68-82, lib/git/local.ts:238-246, lib/engine/runtime/worktree-lifecycle.ts:76-78, lib/engine/runtime/fanout/merge-arena.ts:91, lib/engine/nodes/shared/run-context.ts:107
- **What to do:** `LocalGit.cloneDir(flowId)`, `workspaceForFlow(flowId)` and `WorktreeManager.worktreeDirForFlow(flowId)` all still resolve to `workspaces/<flowId>`. `MergeArena.ensureWorkspace` now calls `localGit.ensureClone(parentFlowId)` on every arena use, which clones into, or runs `fetch --prune` against, the same directory the parent's local worktree occupies. Fix: namespace the two roots (`workspaces/clones/<id>` and `workspaces/worktrees/<id>`) through one path-builder; no legacy-dir migration is needed.

### CR-107 [Medium] Worktree ensure is de-duplicated per `flow:branch` while the directory is per flow, so concurrent runs can switch branches under a live agent

- **Status:** Fixed
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/runtime/worktree-lifecycle.ts:183-193, lib/engine/runtime/worktree-lifecycle.ts:76-78, lib/git/worktrees.ts:288-291, lib/git/worktrees.ts:480-495
- **What to do:** `ensureInFlight` is still keyed on `${flowId}:${branch}` while the directory is per flow. `createWorktree` on an existing worktree still calls `switchWorktreeBranch`, which checks out another branch with no dirty check and no lock, and only warns on failure. Fix: key on `flowId` and re-check the branch once the in-flight ensure settles; refuse to switch when `isWorktreeDirty`, returning `{ switched: false, reason }`; add a per-directory async mutex around create, switch and remove.
- **Fix after:** CR-106 (this task)

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
