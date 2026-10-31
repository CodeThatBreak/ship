# Task 60: Security: script env, SSRF redirects, injection in URLs and git refs

- **Phase:** Phase 6: Security (last)
- **Depends on:** [Task 57: Security: authenticate the local API](57-security-local-api-hardening.md)
- **Findings:** CR-016, CR-068, CR-199, CR-100, CR-105, CR-188, CR-189, CR-190
- **Effort:** M

## Goal

Script nodes inherit the whole server env, the SSRF guard replays secret headers across redirects, HTTP node values are interpolated into URLs unencoded, branch names reach git unvalidated, and shared-dir specs can escape the worktree.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-016 [High] The script node passes the server's whole `process.env` to user scripts, contrary to its "allowlisted env" contract

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/script/script-node.ts:336-345 (execa call), 254 (childEnv), 31 (doc claims allowlist)
- **What to do:** `execa` (still 10.2.1) is called with `env: opts.env` and no `extendEnv: false`, so the whole server `process.env` (Cursor key, git tokens and so on) is merged under the allowlist for every script node. Pass `extendEnv: false` and add a test asserting that a non-allowlisted variable is absent in the child.

### CR-068 [Medium] SSRF guard forwards all request headers, secrets included, across cross-host redirects

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/net/ssrf-guard.ts:79-99,121-145
- **What to do:** On redirect the guard re-validates the target against the allowlist but still replays `req.headers` (which carry interpolated `{{secrets.*}}`) to the new host, and allowlist entries match subdomains, so credentials leak across cross-origin redirects. Drop `authorization`/`cookie`/`proxy-authorization` and secret-bearing headers when `next.origin !== url.origin`, or refuse cross-origin redirects unless explicitly enabled.

### CR-199 [Low] HTTP node: interpolated values go into the URL unencoded

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/http/http-node.ts:114-119,196-221
- **What to do:** `{{input.*}}` and `{{nodes.*}}` values, which can come from agent output or webhook payloads, are still inserted into the URL unencoded. A value like `x&admin=true` or `../other` can change the path or query on the allowlisted host, and the SSRF guard only checks the host. Header values are still inserted raw, so CR/LF fails with an opaque error. Apply `encodeURIComponent` to non-secret values interpolated into `url` (with an explicit raw escape hatch if needed), and reject header values containing `\r` or `\n` with a clear error.

### CR-100 [Medium] Branch and ref names reach git argv without validation or a `--` separator (option-injection surface)

- **Status:** Open
- **Type:** Security
- **Effort:** M
- **Where:** lib/git/worktrees.ts:485-489, 636; lib/git/local.ts:87, 108, 150, 161, 163, 187; lib/integrations/local-agent/agent.ts:123, 133, 138; lib/engine/runtime/fanout/merge-arena.ts:169, 219, 234, 278-280; lib/engine/nodes/kinds/build/build-run-support.ts:31-44; lib/engine/nodes/kinds/plan/schema.ts:15
- **What to do:** There is still no branch-name validation or `--end-of-options` before positional refs. `branch_pattern` tokens (`{suffix}`, `{ticket}`) are unsanitized, and the plan step `branch` is a bare `z.string()`. Branch-record `name` is regex-validated, so only the pattern and ticket path remains. Fix: `assertValidBranchName()` in `lib/git` (reject a leading `-`, run `git check-ref-format --branch`, throw `InvalidBranchNameError`) at every public entry point. Insert `--end-of-options` where git supports it.

### CR-105 [Medium] `shared_dirs` entries are not confined to the hub/worktree (path traversal) and the denylist is bypassable

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/git/worktree-setup.ts:116-131, lib/git/worktree-setup.ts:490-515
- **What to do:** `SharedDirsStep` still does `path.join(hub|wt, spec)` without normalizing or checking containment, so `../x` creates links outside the worktree. The `DENIED_SHARED_DIRS` exact-string `Set` check is bypassed by `./node_modules`, `node_modules/` or `a/../node_modules`. Fix: normalize, reject absolute paths and paths starting with `..`, assert `containsPath(hub, src)` and `containsPath(wt, dst)`, and check every path segment against the denylist.

### CR-188 [Low] SSRF helper throws `SsrfReason`, not `SsrfError`, so callers see two error types for one policy

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/net/ssrf-helpers.ts:44,49,56,83-89; lib/net/ssrf-guard.ts:43-48,110-121
- **What to do:** The helpers still throw `SsrfReason`, which `resolveAndCheck` does not catch. Blocked private IPs therefore surface as `SsrfReason`, while scheme and allowlist rejections are `SsrfError`. Nothing outside `lib/net` checks `instanceof` today, so the impact is latent. Move `SsrfError` into a shared `ssrf-error.ts`, throw it from the helpers, and delete `SsrfReason`.

### CR-189 [Low] SSRF guard has no DNS timeout and only an idle socket timeout

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/net/ssrf-helpers.ts:22,30-32; lib/net/ssrf-guard.ts:79-99,175-177
- **What to do:** `lookupAll` still has no timeout (the constant is unused), and `req.setTimeout` is still only an idle timeout applied per hop. A slow-trickle server can keep an http node running indefinitely, and the time budget multiplies across up to 5 redirects. Race the lookup against `RESOLVE_TIMEOUT_MS`, and enforce one total deadline (an `AbortController` or timer started in `guardedRequest`) across all hops.

### CR-190 [Low] IPv6 literal URLs never match the IP-literal path, because `URL.hostname` keeps the brackets

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/net/ssrf-helpers.ts:24-28; lib/net/ssrf-guard.ts:110-113
- **What to do:** Confirmed in Node: `new URL("http://[2001:db8::1]/").hostname` is `"[2001:db8::1]"`, so `ipaddr.isValid` rejects it and the request falls through to a failing DNS lookup. This fails closed, but allowlisted IPv6 literals can never work and the error text is misleading. Strip the surrounding `[`/`]` before `isValid`/`parse`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
