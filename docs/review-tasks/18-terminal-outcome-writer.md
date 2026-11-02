# Task 18: One terminal-status writer per node

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 17: Atomic node claims and attempt identity](17-node-claim-and-attempts.md)
- **Findings:** CR-092, CR-206, CR-074, CR-088, CR-203
- **Effort:** M

## Goal

Pipeline, resolve, start, build-recover, http and script still hand-roll their final `setNode` + emit, and `recover()` contracts disagree. Make `applyOutcome` the only terminal writer and fix the run-tagging and input-overwrite bugs on the way.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-092 [Medium] Built-ins bypass the shared `execute`/`applyOutcome` persistence path and hand-roll status, output and event writes

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/nodes/kinds/pipeline/pipeline-node.ts:327-332, 417-431, 440-451, 474; lib/engine/nodes/kinds/resolve/resolve-node.ts:98-105; lib/engine/nodes/kinds/start/start-node.ts:74-83; lib/engine/nodes/kinds/build/build-node.ts:440-456; lib/engine/nodes/kinds/http/http-node.ts:92-98, 152-154; lib/engine/nodes/kinds/script/script-node.ts:107-111, 120-121, 132-133, 179-180; lib/engine/nodes/kinds/plan/plan-node.ts:230-241, 276-288
- **What to do:** Plan, agent and decision success and recover paths now finish through `applyOutcome`. Pipeline (green/failed/canceled), resolve's no-comments early return, start (event "Flow started…" vs returned "flow started"), build `recoverBranch`, and the http/script failure paths still hand-roll `setNode` + emit. Fix: make `applyOutcome` (with optional agentId) the only terminal writer, have `recover()` return a `RunOutcome`, and add a base `markRunning()`.
- **Fix after:** CR-014 ([Task 16](16-run-lifecycle-late-writes.md)), CR-015 ([Task 17](17-node-claim-and-attempts.md))

### CR-206 [Low] `recover()` contracts are inconsistent across nodes (double-fail, or "recovered" after failing)

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/script/script-node.ts:106-112; lib/engine/nodes/kinds/http/http-node.ts:92-98; lib/engine/flow-engine.ts:1955-1961; lib/engine/nodes/shared/node-definition.ts:262-266
- **What to do:** The script node still sets `failed` and emits an error, then returns `false`, so the engine fails the node again (and emits a second error when the run did not finish). The HTTP node still sets `failed` and returns `true` ("recovered"). Fix: have both return `false` with no side effects, and document the contract on `NodeDefinition.recover`.

### CR-074 [Medium] Per-branch cost attribution never applies: `tagLatestRun` runs after the run row is already closed

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/build/build-node.ts:327-333, lib/engine/nodes/kinds/build/branch-store.ts:39-45, lib/engine/harness/agent-runner.ts:168-169, lib/engine/nodes/shared/agent-run-node.ts:132-134
- **What to do:** `execute()` runs `finalize` only after `executeRun` has already closed the run row to finished/error. `tagLatestRun`'s `WHERE node_id=? AND status='running'` therefore never matches, and `runs.branch_id` stays null. Fix: return the run row id from `executeRun` (or pass a branchId option) and tag `WHERE id=?`.

### CR-088 [Medium] An agent-node chat overwrites the recorded input, so a later Retry loses the inherited upstream input

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/agent/agent-node.ts:383-405 (input at 392), lib/engine/nodes/shared/agent-run-node.ts:124-129, lib/engine/flow-engine.ts:1666,1678
- **What to do:** The agent node's `chat()` still calls `execute()` with `input: {model, feedback}`, which overwrites `nodes.input`. A later `retryNode` replays that, losing the inherited upstream fields, and `{{input.*}}` renders empty. Fix: merge `{...node.input, feedback}`, or add an `execute` option that skips recording input for follow-ups.

### CR-203 [Low] Build, review, resolve and pipeline `chat()` overrides drop the chat panel's model override

- **Status:** Partly fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/pipeline/pipeline-node.ts:628-643
- **What to do:** Build, review and resolve now go through `AgentRunNode.chat(ctx, content, model)` and `chatInput(content, model)`, so the chat panel's model is honored. The pipeline override still declares `chat(ctx, content)` and spreads the previous input, so the developer's model pick is ignored (the previous run's model, or the default, is used). Fix: accept `model?: string` and set `model: model ?? null` in the parsed input.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
