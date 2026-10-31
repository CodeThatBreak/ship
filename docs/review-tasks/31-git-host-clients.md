# Task 31: GitLab and Jira clients: timeouts, paging, typed errors

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md)
- **Findings:** CR-025, CR-098, CR-099, CR-225, CR-219, CR-220, CR-198
- **Effort:** L
- **Needs approval:** CR-198 changes how `tasks.id` is assigned and matched, which is a schema change. Ask first.

## Goal

No GitLab or Jira call has a timeout, lists are capped at one page, errors are untyped with no retry, the review uses the deprecated `/changes` endpoint, SSH URLs don't parse, and Jira task ids collide across instances.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-025 [High] No timeouts on any GitLab/Jira HTTP call — pollers and settings requests can hang indefinitely

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** lib/integrations/gitlab/client.ts:75-82 (api), 139-145 (getJobTrace), 311-322 (testInstance); lib/integrations/jira/service.ts:76-93; lib/engine/tasks/providers/jira.ts:236 (fetchByJql)
- **What to do:** No GitLab or Jira `fetch` passes an `AbortSignal` (there are zero `signal:` / `AbortSignal` uses in `lib/integrations`), so an unreachable host stalls the poller tick and settings requests until the OS TCP timeout. Add `signal: AbortSignal.timeout(<module const>)` to each call and map `TimeoutError` to a typed error.

### CR-098 [Medium] GitLab list endpoints are not paginated — comments beyond 100 discussions and jobs beyond 20 are silently dropped

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/gitlab/client.ts:98-102, 125-127, 147-149
- **What to do:** Unchanged. Discussions are capped at one page of 100, pipeline jobs use GitLab's default 20 with no paging, and MR lists are unpaged. The resolve node and pipeline gate miss comments and failed or manual jobs on busy MRs. Fix: a private `paginate<T>(path)` in `GitLabClient` that uses `per_page=100` and follows `x-next-page` up to a bounded page cap.

### CR-099 [Medium] GitLab API errors are untyped strings with the full response body; no 429/5xx retry

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** lib/integrations/gitlab/client.ts:75-82, 139-145; lib/integrations/gitlab/git-host.ts:223, 238
- **What to do:** Unchanged. `api()` throws a plain Error that embeds the full response body, with the status buried in the text. There is no typed error and no 429/5xx retry, so a rate limit during polling fails the node. Fix: `GitHostApiError {status, path, retryAfterMs}` (plus NotFound/Auth subclasses) in the git-host port, with the body truncated to about 500 chars. Add bounded retry with `Retry-After` for idempotent GETs on 429/502/503/504.

### CR-225 [Low] `getMRChanges` uses the deprecated `/changes` endpoint and ignores truncation

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/gitlab/client.ts:104-106,262-263; lib/integrations/gitlab/git-host.ts:102-110
- **What to do:** This still uses the deprecated `/merge_requests/:iid/changes` endpoint and ignores `overflow`, so the AI review can silently review a truncated diff. Fix: switch to the paginated `/diffs` and surface a `truncated` flag on the port result.
- **Fix after:** CR-098 (this task)

### CR-219 [Low] SSH-style repo URLs are not supported by GitLab project-path parsing

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/integrations/gitlab/client.ts:51-57,233-244
- **What to do:** The project-path parsing still uses `/^[a-z]+:\/\/[^/]+\/(.+)$/i`, so scp-style `git@host:group/repo.git` is URL-encoded whole and every API call 404s. `hostOf` returns null for it too. Fix: parse the `user@host:path` form (and `ssh://`) and validate repo URLs with Zod at registration.
- **Fix after:** CR-024 ([Task 59](59-security-credential-hygiene.md))

### CR-220 [Low] Jira credential test hardcodes the Cloud v3 API and Basic auth; multiple instances are silently ignored

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/integrations/jira/service.ts:62-68,76-93
- **What to do:** `testInstance` still always calls `/rest/api/3/myself` with Basic `email:token`, so Data Center PATs (`/rest/api/2` with Bearer auth) likely fail; this still needs checking against a DC instance. `active()` still returns `listInstances()[0]`, silently ignoring any other instance. Fix: store a per-instance deployment/auth kind, and either reject a second instance or make the active instance explicit.

### CR-198 [Low] Jira materialization uses the provider's numeric issue id as the global `tasks.id`

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/tasks/providers/jira.ts:242-262,285; lib/db/schema.sql:3-18
- **What to do:** The upsert still matches on the globally `UNIQUE` `key` and inserts `id = issue.id`, the provider's numeric id. Several Jira instances can be registered, with one active at a time via `jira.active()`, so switching instances can cause a primary-key collision or re-bind a task to another instance's issue. The file also still holds two classes (`AdfRenderer`). Use `db.uid("task_")` for the id and match on `(type, instance, key)`; this needs a schema change, which must be approved first per AGENTS.md. Move `AdfRenderer` to its own file.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
