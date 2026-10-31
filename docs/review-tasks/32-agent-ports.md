# Task 32: Agent port reliability (Cursor SDK and local agent)

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md)
- **Findings:** CR-109, CR-110, CR-111, CR-223, CR-101, CR-102
- **Effort:** M

## Goal

Run lookups turn every error into "still running", cloud cancel after restart is a no-op, `run.wait()` can reject unhandled, run handles leak, local `ensureBranch` has no timeout, and `local_agent.timeout_ms` is never read.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-109 [Medium] Cursor `getRun`/`reattachRun` swallow every error as "still running"

- **Status:** Fixed
- **Type:** Bug
- **Effort:** M
- **Where:** lib/integrations/cursorSdk.ts:338-385, lib/integrations/cursor/client.ts:77-80, lib/integrations/cursor/agent-port.ts:58-60
- **What to do:** `getRun` and `reattachRun` still wrap everything in `catch { return null }`, so auth failures, 404s and network errors look the same as "still running" or "terminal" to reconcile. Fix: return a discriminated result (`running | done | unavailable{error}`) or throw a typed `AgentRunLookupError`, and update the `AgentPort.getRun` contract.

### CR-110 [Medium] Cloud-run cancel after a restart is a silent no-op that reports success

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/cursor/client.ts:96-98, lib/integrations/cursor/agent-port.ts:62-69, lib/integrations/cursorSdk.ts:271-277
- **What to do:** `CursorClient.cancelRun` still discards the boolean from `cursorAgent.cancelRun`, and the port returns `true` unless it throws. After a restart, a cloud run keeps going while the UI shows it cancelled, and `run.cancel()` rejections are swallowed. Fix: when there is no live handle and the agent id starts with `bc-`, re-attach via `Agent.getRun(..., { runtime: "cloud" })` and call `cancel()`; propagate the result or a typed error.

### CR-111 [Medium] `pumpRun` can leave a rejected `run.wait()` promise unhandled

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/cursorSdk.ts:299-307
- **What to do:** `pumpRun` still creates `done = run.wait()` before the `for await` stream loop, with no handler attached. If `stream()` throws and `wait()` later rejects, the rejection is unhandled and can crash the process. Fix: wrap the loop in `try/finally` and `await done.catch(() => {})` in the finally block (or attach a catch immediately).

### CR-223 [Low] In-process run handles leak if a started run is never streamed

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/cursorSdk.ts:148-150,267,272-278,284-292; lib/engine/harness/agent-runner.ts:116-118
- **What to do:** `createRun` still registers the handle, and only `streamRun`'s `finally` removes it and closes the agent. `cancelRun` doesn't release it, and any throw between `start()` and `port.stream` (for example `persistRun`) leaks the handle while `hasActiveRun` stays true. This is still unverified at runtime. Fix: release and close in `cancelRun`, and add a `release(runId)` for callers' `finally` (or a TTL sweep).

### CR-101 [Medium] Local-agent `ensureBranch` runs git with no timeout and can target the server's own cwd when no workspace is given

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/local-agent/agent.ts:121-142, 168-170; lib/integrations/local-agent/agent-port.ts:37-38
- **What to do:** `ensureBranch` still runs `git fetch`/`rev-parse`/`checkout` with no timeout, so a stalled remote blocks `createRun`. The port still falls back to `workspace: ""`. That fallback is latent today because `AgentRunner` always sets `spec.workspace = requireRunCwd(ctx)`, but any other caller would run git in `process.cwd()`. Fix: route `ensureBranch` through the bounded git wrapper (like `lib/git/local.ts:46-53`), and throw a typed error in the port when neither cwd nor workspace is set.
- **Fix after:** CR-214 ([Task 33](33-git-and-worktree-process-safety.md))

### CR-102 [Medium] `local_agent.timeout_ms` setting is exposed in Settings but never enforced — local runs can run forever

- **Status:** Fixed
- **Type:** Gap
- **Effort:** S
- **Where:** lib/integrations/local-agent/agent.ts:86-95, 159-184, 209-220; app/api/settings/route.ts:82, 140-145
- **What to do:** Unchanged. `local_agent.timeout_ms` is settable and validated in Settings but nothing reads `defaults().timeoutMs`. `createRun` forwards only sandbox/force, and `streamRun` has no timer, so a wedged local run keeps the node `running` and holds the worktree forever. Fix: arm a timer in `streamRun` (or the port's `stream`) that calls `cancelRun` after `timeoutMs` and rejects with a typed `AgentRunTimeoutError`, or remove the setting.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
