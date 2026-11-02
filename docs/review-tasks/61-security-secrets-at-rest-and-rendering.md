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

- **Status:** Fixed (Task 61 — `IntegrationSecretStore` + AES-256-GCM via `DEVFLOW_SECRETS_KEY`; `listMeta` / per-id token reads; migration user_version 6)
- **Fix after:** CR-118 ([Task 48](48-backend-dependency-injection.md))

### CR-154 [Medium] Shared `Markdown` loads remote images from any origin in agent-authored content (exfiltration vector)

- **Status:** Fixed (Task 61 — `markdownRehypePlugins` with empty `allowedImagePrefixes` and restricted protocols)

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
