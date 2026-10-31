# Task 09: Typed domain errors and one route error mapper

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 02: Make typecheck, lint and tests real gates](02-typecheck-and-build-gates.md)
- **Findings:** CR-046
- **Effort:** M

## Goal

The engine throws bare `Error`, so routes map everything to 400 or leak a 500. Add the error hierarchy from `docs/coding-patterns.md` and a single `toErrorResponse(e)` that every route uses. Later tasks depend on it for correct 404 and 409 responses.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-046 [Medium] No typed error classes: the engine throws bare `Error`, so routes map almost everything to 400 (or leak an unhandled 500)

- **Status:** Fixed (Task 09 — `lib/errors.ts`, `toErrorResponse`, engine/route adoption)
- **Type:** Code quality
- **Effort:** M
- **Where:** app/api/flows/[id]/action/route.ts:124-130, app/api/flows/[id]/chat/route.ts:27-29, app/api/templates/[id]/route.ts:72-77,132-134, app/api/hooks/[id]/route.ts:77-79, app/api/host-instances/[host]/[id]/route.ts:6-36, app/api/settings/route.ts, app/api/webhooks/gitlab/route.ts, lib/engine/flow-engine.ts:548,574,1667, lib/integrations/gitlab/git-host.ts:223,238
- **What to do:** Still no `NotFoundError`/`ConflictError`/`ValidationError`; the engine throws bare `Error` ("flow not found", "already running", "host instance not found") and routes map everything to 400 or leak an unhandled 500 (host-instances, settings, gitlab webhook). The action route's new `httpStatus` duck-typing is dead code (nothing in `lib/` sets it). Add a shared errors module + `toErrorResponse(e)` helper and use it across routes.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
