# Task 57: Security: authenticate the local API

- **Phase:** Phase 6: Security (last)
- **Depends on:** nothing, can start any time
- **Findings:** CR-001, CR-002
- **Effort:** M

## Goal

Any web page can POST to the unauthenticated API and run a shell command via `test-setup`, and the instance test endpoints send stored tokens to a caller-supplied `baseUrl`.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-001 [Critical] State-changing API has no auth, CSRF or Origin check, so any website can make DevFlow run shell commands

- **Status:** Open
- **Type:** Security
- **Effort:** M
- **Where:** (no middleware.ts at repo root); app/api/repos/test-setup/route.ts:38-75; app/api/settings/route.ts:104-178; app/api/repos/route.ts:36-62; app/api/host-instances/[host]/route.ts:14-25; app/api/task-instances/[kind]/route.ts:19-39; package.json:6,8 (`next dev` / `next start` with no `-H 127.0.0.1`)
- **What to do:** Still no session/token, Origin, Sec-Fetch-Site or Content-Type check on any state-changing route, and `/api/repos/test-setup` still passes a caller-supplied `setup_command` straight to `worktreeSetup.probe`. Add a root `middleware.ts` for `/api/:path*` that rejects non-GET requests unless the Origin matches and the body is `application/json`, plus a startup-generated local token (exempt `/api/hooks/*` and `/api/webhooks/*`), and bind dev/start to 127.0.0.1.

### CR-002 [High] The instance "test" endpoints send the stored token to a caller-supplied `baseUrl`

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** app/api/host-instances/[host]/[id]/route.ts:29-36 (test), 6-17 (PATCH); app/api/task-instances/[kind]/[id]/route.ts:39-58 (test), 6-26 (PATCH); app/api/host-instances/[host]/route.ts:14-25; app/api/task-instances/[kind]/route.ts:19-39; lib/integrations/gitlab/git-host.ts:236-240; lib/engine/tasks/providers/jira.ts:87-98; lib/integrations/gitlab/client.ts:311-322; lib/integrations/jira/service.ts:76-93
- **What to do:** `testInstance` still pairs a caller-supplied `baseUrl` with the stored token (`input.baseUrl ?? existing.base_url`, `input.token || existing.token`) for both GitLab and Jira, so a request that sends only `{baseUrl}` ships the stored PAT or Basic credentials to any host. Reject a `baseUrl` override unless `token` is also supplied, and validate `baseUrl` with Zod (https URL) plus the SSRF guard in the add/update/test routes.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
