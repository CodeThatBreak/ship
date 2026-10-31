# Task 21: Multi-branch (complex plan) flows

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 18: One terminal-status writer per node](18-terminal-outcome-writer.md)
- **Findings:** CR-011, CR-017, CR-019, CR-020, CR-083, CR-094
- **Effort:** M
- **Needs approval:** CR-083 persists the real git branch on the `branches` row, which is a schema change. Ask first.

## Goal

Many paths still assume one branch per flow: the poller compares against a flow-wide event, resolve pulls every MR's comments, the commit-fix runs on the wrong branch, and downstream nodes ignore `branch_pattern`. Fix them together with a multi-branch test fixture.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-011 [High] Poller compares each branch's pipeline against the flow-wide last `pipeline` event, re-triggering the gate every tick

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/flow-poller.ts:53-67 (per-branch loop), 112-139 (checkPipeline)
- **What to do:** `checkPipeline` still compares each branch's head pipeline with the flow-wide latest `pipeline` event, so two branches in different states flip-flop every tick and `triggerPipelineGate` is re-fired for the failed one whenever the gate isn't running. Scope `prev` per branch (`json_extract(data,'$.branchName') IS ?`), or track the last seen (branch, pipeline id, status), and trigger the gate only on a transition to `failed` for a new pipeline id.

### CR-017 [High] Multi-branch resolve picks up and resolves comments from every MR in the flow

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/resolve/resolve-node.ts:97, 166-175; lib/engine/nodes/shared/node-support.ts:163-165 (openComments filters flow_id only); lib/engine/flow-engine.ts:2008-2010 (ingest writes mr_iid = null)
- **What to do:** The open-comment query is still flow-wide, and ingestion still stores `mr_iid` as `null`. A per-branch resolve therefore pulls other branches' comments into its prompt, calls `resolveComment` on the wrong MR, and marks them resolved locally. Store `mr_iid` on ingest (pass it from the poller's per-branch loop) and filter `openComments(flowId, mrIid)`.

### CR-019 [High] MR creation forces the pipeline and review nodes to `pending` even while they are running, and throws when they don't exist

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/merge-request/merge-request-service.ts:124-128; lib/engine/nodes/chains/sdlc-chain.ts:72-86 (per-branch create loop)
- **What to do:** After each CR is created, `nodeByKey(flow.id, NODE_KEYS.PIPELINE/REVIEW)` is still forced to `pending`, including while it is `running`. That happens once per branch in multi-branch flows, and it throws after the MR exists when the template lacks those built-in keys. Pass the chain's resolved gate and review keys in, skip `running` nodes, and reset once after all branches' MRs exist.

### CR-020 [High] For multi-branch flows, the commit-fix agent runs on the wrong branch

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/chains/sdlc-chain.ts:112-135 (runBuildCommitFix passes branchInfo: null); lib/engine/nodes/kinds/build/build-node.ts:354-382 (refine uses flowBranch / ctx.flow.mr_branch)
- **What to do:** `runBuildCommitFix` still ignores the rejected `branch` and runs the build with `branchInfo: null`, and `refine()` works on the flow's last-built `mr_branch`. A push rejection on branch A is therefore "fixed" on another branch. Pass `branchInfo: { name: branch }` when set, and have `refine()` resolve its worktree branch from `branchInfo` using the build's naming helper.

### CR-083 [Medium] Multi-branch MR, pipeline, review and resolve derive the git branch without the build's `branch_pattern`

- **Status:** Fixed (`branches.git_branch`, migration user_version 3)
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/nodes/kinds/build/build-run-support.ts:31-44 (honors branch_pattern), lib/engine/nodes/kinds/merge-request/merge-request-service.ts:62, lib/engine/nodes/kinds/pipeline/pipeline-node.ts:144-153, lib/engine/nodes/kinds/review/review-node.ts:57-60, lib/engine/nodes/kinds/resolve/resolve-node.ts:87-91
- **What to do:** Downstream consumers still rebuild multi-branch git branch names with `ctxHelper.buildBranch(ctx, branchName)`, which ignores a custom `branch_pattern`. With a custom pattern, the MR push/lookup and the fix/resolve checkout target a non-existent branch. Fix: persist the actual git branch on the `branches` row in `finalizeBuild` (it knows `resultBranch`) and have every consumer read it from there. This needs a schema change, so ask first.

### CR-094 [Medium] Built-in nodes duplicate MR resolution, the "result branch + diff artifact" finalize, and the latest-plan query

- **Status:** Fixed (`MrTargetResolver`, `BranchNamer`; latest-plan ordering remains NEW-C1)
- **Type:** Code quality
- **Effort:** M
- **Where:** resolveMr: lib/engine/nodes/kinds/pipeline/pipeline-node.ts:140-160, lib/engine/nodes/kinds/review/review-node.ts:57-64 (public), lib/engine/nodes/kinds/resolve/resolve-node.ts:84-95 (inline, nullable mrIid); branch naming: lib/engine/nodes/kinds/build/build-run-support.ts:31-44, lib/engine/runtime/fanout/step-flow-manager.ts:407 vs lib/engine/nodes/shared/run-context.ts:91; latest plan: lib/engine/nodes/shared/node-support.ts:120-149 vs lib/engine/flow-engine.ts:903-910
- **What to do:** The diff-artifact finalize is consolidated in `BuildRunSupport.diffArtifact`. The five latest-plan queries are down to two helpers, but they disagree on ordering (see NEW-C1). MR resolution is still copied three times with different errors, and the branch prefix/slug logic is still duplicated. Fix: a shared `MrTargetResolver.resolve(ctx, branchName)` in `nodes/shared` and a `BranchNamer` used by `buildBranch`, `BuildRunSupport.branchName` and the step-flow manager.
- **Fix after:** NEW-C1, CR-083 (this task)

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
