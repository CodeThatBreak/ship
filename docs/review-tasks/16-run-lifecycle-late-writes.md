# Task 16: Late-write guard and run-row lifecycle

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md); [Task 05: Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md)
- **Findings:** CR-014, CR-081, CR-269, CR-082, CR-205
- **Effort:** M

## Goal

When a run is superseded, callers still finalize, so cancelled nodes come back. Chat-only replies trip the guard and can fail finished nodes. Run rows stay `running` after stream errors. Make a superseded run stop with no writes, and always close the run row.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-014 [High] When the late-write guard fires, callers still finalize, which brings cancelled nodes back and overwrites state

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/harness/agent-runner.ts:171-182; lib/engine/nodes/shared/agent-run-node.ts:132-134 (execute); lib/engine/nodes/shared/node-definition.ts:303-321 (applyOutcome); lib/engine/nodes/kinds/plan/plan-contract.ts:236-266 (turnRetry); lib/engine/nodes/kinds/pipeline/pipeline-node.ts:599-620 (runFix); lib/engine/nodes/kinds/resolve/resolve-node.ts:166-175 (finalize resolves host comments)
- **What to do:** The late-write guard still returns `result` exactly as on success, so `execute()` runs `finalize`, then `applyOutcome` writes the final status over a cancelled node. Plan's retry path, resolve's host-side comment resolution and pipeline's fix artifact all still run. Throw a typed `RunSupersededError` (or return a discriminated result), catch it in `execute()`, the plan turn and the pipeline fix to stop with no write, and add a "still running?" check in `applyOutcome`.

### CR-081 [Medium] `converse()` (chat-only) always trips the late-write guard: it logs a spurious "ignoring" event and hides run errors

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/shared/agent-run-node.ts:81-105, lib/engine/harness/agent-runner.ts:175-187
- **What to do:** `converse()` still calls `executeRun` while the node is done/awaiting_approval. Every chat-only reply therefore logs "…result arrived after the node was already … — ignoring", and returns before the `status !== "finished"` check, so errored conversational runs come back as normal replies. Fix: add an `ownsNodeStatus: false` option that skips the guard, and run the terminal-status check before the guard.
- **Fix after:** CR-014 (this task)

### CR-269 [Medium] Chat-only replies run inside `bg()`, so an agent error flips a finished node to `failed`

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:598-615,1726-1746, lib/engine/nodes/shared/agent-run-node.ts:81-105, lib/engine/harness/agent-runner.ts:171-182
- **What to do:** The chat-only ("just chat") path claims to leave node state untouched, but `sendChat` runs it through `bg(flowId, nodeKey, …)`, whose catch sets the node to `failed`. Any agent start or stream error during a question therefore flips an `approved`/`done`/`awaiting_approval` node to `failed`. Also, because `converse()` uses `executeRun` on a non-running node, every successful reply emits a misleading "result arrived after the node was already … — ignoring" lifecycle event. Run the chat-only branch with `bg(flowId, null, …)`, or catch and reply with the error, and give `executeRun` a converse mode that skips the late-write guard event.

### CR-082 [Medium] A failure in stream or usage capture leaves the run row `running` and fails an agent run that finished

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/harness/agent-runner.ts:148-169, lib/engine/harness/usage-tracker.ts:127-160 (port.getUsage at 140-142), lib/engine/harness/pricing-source.ts:90
- **What to do:** The run-row status update still sits after the try/finally, so a `port.stream` rejection leaves the row `running`. `captureRunUsage` (including the cloud `getUsage` call) is inside the same try, so a usage failure fails a finished agent run. The LiteLLM fetch errors are caught but it has no timeout. Fix: close the run row in `finally` (`error` when there's no result), wrap usage capture in its own try/catch that logs, and add `AbortSignal.timeout()` to the pricing fetch.

### CR-205 [Low] `StreamBuffer` reports the wrong "chars omitted" count once text has been capped

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/harness/stream-buffer.ts:25-30,41-48; lib/engine/harness/agent-runner.ts:138-145
- **What to do:** `capHeadTail` still re-caps the already-capped text on every push, so the "N chars omitted" marker drops earlier counts and under-reports. Tool events are also still emitted immediately while assistant and thinking text waits up to 1.5 s, so the feed shows them out of order. Fix: keep `head`/`tail`/`omitted` counters per buffer, and flush the text buffers before emitting a tool event.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
