# Task 59: Security: tokens out of URLs, logs and the client

- **Phase:** Phase 6: Security (last)
- **Depends on:** [Task 57: Security: authenticate the local API](57-security-local-api-hardening.md)
- **Findings:** CR-023, CR-024, CR-254, CR-264, CR-265
- **Effort:** M

## Goal

GitLab tokens are embedded in clone/push URLs (and `.git/config`) and leak into error text, the single-instance fallback sends the token to foreign hosts, hook secrets ship to the cockpit, and `.gitignore` only covers the literal `.env`.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-023 [High] GitLab token embedded in git clone/push URLs leaks into error text, the event log, `step_merges.error` and on-disk `.git/config` (local clones and merge arena)

- **Status:** Open
- **Type:** Security
- **Effort:** M
- **Where:** lib/integrations/gitlab/git-host.ts:188-203 (oauth2:<token>@ URL); lib/engine/ports/git-host.ts:278-282; lib/git/local.ts:57-60, 77 (clone persists token in .git/config), 161, 170 (push error message interpolated, 300 chars); lib/engine/runtime/fanout/merge-arena.ts:91-94 (arena clone), 221-258, 289-293 (errorText unredacted into step_merges.error/events)
- **What to do:** Clone and push URLs still embed `oauth2:<TOKEN>@`, which persists the token in every workspace's and arena's `.git/config`. `pushBranch` and merge-arena `errorText` still forward raw git messages and stderr into events and `step_merges.error` with no redaction. Supply credentials out of band (`GIT_CONFIG_*` `http.extraHeader` or `GIT_ASKPASS`), clone with plain URLs, add one shared redaction pass in both git wrappers, and rewrite existing `remote.origin.url`s.

### CR-024 [High] Single-GitLab-instance fallback claims every repo host and sends the GitLab token to foreign hosts

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/integrations/gitlab/client.ts:209-221 (instanceForRepo single-instance fallback); lib/integrations/gitlab/git-host.ts:175-182 (ownsRepo), 188-203 (authedCloneUrl)
- **What to do:** With one GitLab instance registered, `instanceForRepo` still returns it for any host, so `ownsRepo` claims e.g. github.com URLs and `authedCloneUrl` embeds the GitLab PAT into a foreign-host URL. Drop the fallback (or limit it to `host === null` SSH-style URLs), and require a host match in `ownsRepo` and `authedCloneUrl`.

### CR-254 [Low] Webhook secrets are part of the client payload types (Needs verification)

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:480, types/flow.ts:115, components/flows/panels/PanelShell.tsx:107-127, types/template-editor.ts:69
- **What to do:** Verified: the flow snapshot (`hooks: hookStore.hooksForFlow(id)`, including `secret`) is polled into every cockpit view. The cockpit uses it: `WaitBanner` prints `hook.secret` in plain text and embeds it in the copied curl. The "drop if unused" option is therefore out. Instead, return a masked secret in the snapshot and add a separate reveal or copy endpoint that the banner calls on demand.

### CR-264 [Low] Local `.env` holds live integration secrets the app no longer reads

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** .env:3,6-8,11-12 (gitignored, never committed)
- **What to do:** The local .env still defines `CURSOR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `GITLAB_BASE_URL` and `GITLAB_TOKEN` (values not printed). No code in lib/, app/ or scripts/ reads them; cursorSdk always passes the DB `apiKey`. The @cursor/sdk env fallback still makes the stray `CURSOR_API_KEY` a latent risk. Remove these keys once they are stored in Settings → Integrations, and rotate them if the file was ever shared.
- **Fix after:** CR-260 ([Task 56](56-docs-refresh.md))

### CR-265 [Low] `.gitignore` only ignores the literal `.env`

- **Status:** Open
- **Type:** Security
- **Effort:** S
- **Where:** .gitignore:3
- **What to do:** Only the literal `.env` is ignored, so `.env.local`, `.env.production`, `.env.*.local` and similar files could still be committed. Replace it with `.env*` plus `!.env.example`.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
