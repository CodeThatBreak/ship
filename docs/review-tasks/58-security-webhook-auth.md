# Task 58: Security: webhook authentication and limits

- **Phase:** Phase 6: Security (last)
- **Depends on:** [Task 57: Security: authenticate the local API](57-security-local-api-hardening.md)
- **Findings:** CR-069, CR-196, CR-176
- **Effort:** S

## Goal

GitLab webhook verification fails open when the secret is unset, the shared-secret fallback is replayable, and hook bodies are fully buffered before the size check and before auth.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-069 [Medium] GitLab webhook verification fails open when `GITLAB_WEBHOOK_SECRET` is unset, and compares the token with a non-constant-time `===`

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/config.ts:21-24, lib/engine/ports/git-host.ts:193-194, lib/integrations/gitlab/git-host.ts:244-248, app/api/webhooks/gitlab/route.ts:28
- **What to do:** Unchanged. `verifyWebhook` still returns true when `GITLAB_WEBHOOK_SECRET` is unset and compares `x-gitlab-token` with `===`; the config doc still says "unset = accept all". Fix: deny by default, with an explicit `GITLAB_WEBHOOK_ALLOW_UNSIGNED=1` opt-in and a startup warning. Compare with `crypto.timingSafeEqual` over sha256 digests (the same pattern `lib/engine/runtime/hook-store.ts:136-140` already uses) and update the port doc.

### CR-196 [Low] Shared-secret webhook fallback has no replay protection

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/engine/runtime/hook-store.ts:136-143,155-171; app/api/hooks/[id]/route.ts:43-46
- **What to do:** The `x-devflow-secret` fallback still accepts deliveries with no timestamp or id, and dedup runs only when a `webhook-id` header is present. A captured fallback request can therefore be replayed indefinitely, and each replay starts a new flow or resumes a waiting node. Require `webhook-id` (for dedup) plus a timestamp window on the fallback path, or explicitly document the fallback as replayable.

### CR-176 [Low] The hook payload cap is checked after the whole body is buffered, and counts characters instead of bytes

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/hooks/[id]/route.ts:35-38
- **What to do:** `await req.text()` still buffers the whole body before the 1 MB check, and it runs before signature verification, so any unauthenticated caller who knows a hook id can make the server buffer arbitrarily large bodies. `raw.length` also still counts UTF-16 code units, not bytes. Reject early on `Content-Length`, then stream-read with a running byte count that aborts past the cap (or at minimum compare `Buffer.byteLength(raw)`).

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
