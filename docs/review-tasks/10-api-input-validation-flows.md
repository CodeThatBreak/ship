# Task 10: Zod at the API boundary: helper and flow routes

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md)
- **Findings:** CR-003, CR-042, CR-047
- **Effort:** L

## Goal

No route validates its body. Add the shared `parseJson(req, schema)` / `parseQuery` helpers, then validate the flow routes first: the action route as a `z.discriminatedUnion("action", …)`, chat, create, events.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-003 [High] No Zod validation at any API boundary, so bad bodies cause 500s or get saved

- **Status:** Open
- **Type:** Gap
- **Effort:** L
- **Where:** raw `await req.json()` at app/api/flows/route.ts:14, app/api/flows/[id]/action/route.ts:117, app/api/flows/[id]/chat/route.ts:14, app/api/host-instances/[host]/route.ts:18, app/api/host-instances/[host]/[id]/route.ts:10, app/api/repos/route.ts:37, app/api/repos/[id]/route.ts:26-28, app/api/repos/test-setup/route.ts:39, app/api/settings/route.ts:105,134,175, app/api/task-instances/[kind]/route.ts:25, app/api/task-instances/[kind]/[id]/route.ts:11, app/api/tasks/handlers.ts:28, app/api/webhooks/gitlab/route.ts:27; cast-only bodies at app/api/flows/[id]/action/route.ts:9-34, app/api/node-templates/route.ts:30, app/api/node-templates/[id]/route.ts:15, app/api/templates/[id]/route.ts:40, app/api/templates/[id]/validate/route.ts:27, app/api/tasks/materialize/route.ts:14; lib/integrations/jira/service.ts:36
- **What to do:** Only the new split-unit actions (`parseSplitUnitBody`, action/route.ts:101-113) are Zod-validated; every listed failure still reproduces (`local_path.startsWith` 500, `String(h)` allowlist entries, `String(body.default_model)`, `input.email.trim()` on a missing email, unchecked node-template kind). Add a shared `parseJson(req, schema)` helper that returns 400, one schema per route, and a `z.discriminatedUnion("action", …)` for the action route that replaces the hand-written `ActionBody`.

### CR-042 [Medium] `update_plan_steps` with no `steps` field deletes the whole plan checklist

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/flows/[id]/action/route.ts:38, lib/engine/flow-engine.ts:802-834
- **What to do:** `update_plan_steps` still maps a missing `steps` to `[]`; `updatePlanSteps` now refuses removing steps with active/merged children, but every other (deletable) step is silently wiped. Validate `steps` as a required array at the route boundary (Zod, like `splitUnitBody`) and drop the `?? []`; review `config ?? {}` / `chosen ?? []` too.
- **Fix after:** CR-003 (this task)

### CR-047 [Medium] The events endpoint does not validate `limit`

- **Status:** Open
- **Type:** Gap
- **Effort:** S
- **Where:** app/api/flows/[id]/events/route.ts:14-18
- **What to do:** `limit` is still `Number(searchParams.get("limit") ?? 200)` passed straight to SQLite: `?limit=abc` → NaN → 500, `?limit=-1` → unbounded event dump. Parse with `z.coerce.number().int().min(1).max(500).default(200)` and move the query into a `db.listEvents(flowId, after, limit)` method.
- **Fix after:** CR-003 (this task)

## Additional steps

- Convert the remaining routes listed in CR-003 here or in Task 11. Leave a checklist in the PR description of which routes are done.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
