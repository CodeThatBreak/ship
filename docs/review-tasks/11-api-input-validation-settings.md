# Task 11: Zod at the API boundary: settings, repos, instances, templates

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 10: Zod at the API boundary: helper and flow routes](10-api-input-validation-flows.md)
- **Findings:** CR-048, CR-167
- **Effort:** S

## Goal

Finish the boundary validation for settings PATCH (all-or-nothing), the four repo routes (one shared repo input schema) and the remaining routes from CR-003.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-048 [Medium] Settings PATCH writes some fields and then rejects later ones

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/settings/route.ts:104-178
- **What to do:** PATCH still validates and writes field by field, so a bad later field (`default_execution_mode`, `local_agent.timeout_ms`, a non-string secret, `http_allowlist`) returns 400 after earlier fields (API key, harness, …) were already persisted. Validate the whole body up front with one Zod schema, then apply all writes in one `db.transaction` inside a `SettingsService.update(patch)`.
- **Fix after:** CR-003 ([Task 10](10-api-input-validation-flows.md))

### CR-167 [Low] The four repo routes duplicate their input helpers, and `~` expansion is wrong

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** app/api/repos/route.ts:9-26,31,42; app/api/repos/[id]/route.ts:9-20,27-31; app/api/repos/test-setup/route.ts:11-25; app/api/repos/detect/route.ts:9-12
- **What to do:** The four repo routes still each carry their own `~` expansion, `optString` and `optTimeoutMs` (keep-on-absent vs null-on-absent variants), `validateLocalPath` still validates nothing, `~bob/x` still becomes `$HOME/bob/x`, and the `.git` existence check is duplicated. Add one Zod repo-input schema (accept only `~` or `~/` prefixes) in `lib/schemas/repo.ts` and move the path/.git checks into a `RepoService` used by all four routes.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
