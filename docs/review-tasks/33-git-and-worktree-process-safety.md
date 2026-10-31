# Task 33: Git wrappers, worktree setup and process lifetime

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 20: Merge arena locking and workspace directories](20-merge-arena-and-workspaces.md)
- **Findings:** CR-103, CR-104, CR-214, CR-215, CR-218, CR-222, CR-224, CR-073
- **Effort:** M

## Goal

Three separate git exec wrappers with different limits, a blocking `cpSync` fallback, setup commands whose grandchildren survive timeouts, module singletons outside `processSingleton`, and silent fallbacks to `HEAD` and to unauthenticated URLs.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-103 [Medium] Cache/dep copy falls back to synchronous `fs.cpSync` after a timeout, blocking the Node event loop

- **Status:** Fixed (Task 33)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/git/worktree-setup.ts:521-531, lib/git/worktree-setup.ts:23
- **What to do:** `copyDirCoW` still catches every `cp` failure, including the 120s timeout, and then runs a synchronous `fs.cpSync` over the partial copy, which blocks the whole server. Fix: use `await fs.promises.cp`; on timeout (`err.killed`), remove the partial `dst` and report failure; fall back only when the clone is unsupported.

### CR-104 [Medium] Setup/install commands: the timeout kills only the shell, and there is no cancellation path

- **Status:** Fixed (Task 33)
- **Type:** Bug
- **Effort:** M
- **Where:** lib/git/worktree-setup.ts:534-551
- **What to do:** `runCommand` still uses `exec(..., { shell: "/bin/bash", timeout })`. The timeout kills only the bash process, so grandchildren of compound install/setup commands keep running, and there is no `AbortSignal` to cancel setup when a flow is cancelled or deleted. Fix: `spawn` with `detached: true`, kill the process group on timeout or abort, and thread an `AbortSignal` through `WorktreeSetupInput`.

### CR-214 [Low] Duplicated git exec wrappers, timeouts and helpers across three modules

- **Status:** Fixed (Task 33)
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/git/worktrees.ts:8-13,498-504,645-653; lib/git/local.ts:9-14,46-55,126-132,193; lib/integrations/local-agent/agent.ts:17,121-142; lib/integrations/gitlab/git-host.ts:19; lib/integrations/jira/service.ts:14
- **What to do:** There are still three independent `execFile("git")` wrappers. `MAX_BUFFER` differs (10 MB in worktrees, 50 MB in local) and local-agent sets no default timeout. `headBranch` and `currentBranch` are identical, the base-ref fallback chain is duplicated (worktrees 450-463, local 193), and `maskToken` is duplicated in GitLab and Jira. Fix: add a shared `GitRunner` class with timeouts, redaction and typed errors injected into all three, and move `maskToken` to a shared util.

### CR-215 [Low] Module-level singletons created outside `processSingleton`, one with mutable state

- **Status:** Fixed (Task 33)
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/git/worktrees.ts:246,656-657; lib/git/local.ts:236; lib/git/dep-policy.ts:255; lib/git/worktree-setup.ts:294,562; lib/integrations/gitlab/client.ts:325; lib/integrations/jira/service.ts:97; lib/integrations/cursor/client.ts:120; lib/db/rows.ts:433
- **What to do:** These are still plain module-level `new X()` singletons outside `processSingleton`. `worktrees` holds the mutable `inflight` Map, so the "one scan per repo" coalescing splits across `next dev` module graphs, and the comment still calls it "stateless enough". Fix: wrap them with `processSingleton(...)` and correct the comment.

### CR-218 [Low] `listWorktrees` coalescing can serve a pre-mutation scan to callers that require a "fresh" listing

- **Status:** Fixed (Task 33)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/git/worktrees.ts:253-266,320-331,549,611-614
- **What to do:** `listWorktrees` still lets any caller join an in-flight scan. `preflightRemoval`'s "fresh strict re-list", the verify path and the branch-delete guard can therefore act on a scan that started before a concurrent add or remove. Fix: add a `{ fresh: true }` option that bypasses coalescing (or a per-repo generation counter) and use it on those paths.

### CR-222 [Low] `lib/git/local.ts` depends on the engine layer

- **Status:** Fixed (Task 33)
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/git/local.ts:35-38,57-65; lib/engine/ports/git-host.ts:278-284
- **What to do:** Fixed: the layering inversion. `lib/git/local.ts` no longer imports the engine, and callers pass an `AuthedUrlResolver`. Remaining: routing and credential errors are still swallowed twice (`authedCloneUrlFor` and `LocalGit.authedUrl` both catch and fall back to the raw repo URL), so a missing token silently becomes an unauthenticated push. Fix: let the resolver throw a typed error and surface it.

### CR-224 [Low] Worktree base resolution silently falls back to the hub's current `HEAD`

- **Status:** Fixed (Task 33)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/git/worktrees.ts:449-463
- **What to do:** `resolveBaseRef` still ends its candidate chain with `"HEAD"`, so a missing default branch silently cuts the flow branch from whatever the hub has checked out. Fix: drop `HEAD` and throw a typed `BaseRefNotFoundError` naming the configured branch, or fetch `origin <base>` once first.

### CR-073 [Medium] Worktree lifecycle events stamp the node row id as `nodeKey`, misrouting them in the feed

- **Status:** Fixed (Task 33)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/worktree-lifecycle.ts:112-114, 131-135, 144-146, 230-232, 242-243, 248-249, 254
- **What to do:** Unchanged. `opts.nodeId`/`target.nodeId` is a `nodes.id` (callers pass `node.id`), but it is also written into `data.nodeKey`, so feed routing by nodeKey gets a row id. Fix: thread the real node key through opts (or resolve it from the id), or drop `nodeKey` from data when a node id is passed.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
