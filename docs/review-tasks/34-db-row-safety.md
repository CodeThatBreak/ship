# Task 34: Row decoding, repo delete and query indexes

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 08: Canonical schema, atomic bootstrap, no legacy migrations](08-db-bootstrap-and-schema.md); [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md)
- **Findings:** CR-112, CR-114, CR-171, CR-115, CR-113
- **Effort:** M
- **Needs approval:** CR-113 adds indexes to `schema.sql`. Ask first.

## Goal

One bad JSON cell fails a whole list read, deleting a referenced repo is an unhandled FK 500, several reads bypass the row schemas, and hot query columns have no index.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-112 [Medium] One malformed JSON column fails the entire `rows.all()` read

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/db/rows.ts:17-29, lib/db/rows.ts:414-430
- **What to do:** `jsonCol` still turns a parse failure into a Zod issue, and `RowGateway.all` still calls `schema.parse` per row, so one bad JSON cell (for example non-object `events.data` from `emitEvent`) throws for the whole list, with no table, column or row id in the error. Fix: use `safeParse` in `RowGateway`, raise or log a typed `RowDecodeError` with context, and skip bad rows in `all`; optionally make read-tolerant columns fall back to `null`.

### CR-114 [Medium] Deleting a repo referenced by any flow throws an unhandled FK error (500); no foreign key declares `ON DELETE` behaviour

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/db/index.ts:90, lib/db/index.ts:988-990, app/api/repos/[id]/route.ts:54-58, lib/db/schema.sql:20-37, lib/db/schema.sql:151-162
- **What to do:** `deleteRepo` is still a bare `DELETE`, and the route calls it with no checks. Deleting a repo that any flow references throws an FK error (500), and an unknown id returns `{ok:true}`. Fix: add a `RepoService.delete` that throws `NotFoundError` or `RepoInUseError`, mapped to 404/409; longer term, add `ON DELETE` clauses (needs schema approval).
- **Fix after:** CR-046 ([Task 09](09-typed-errors.md))

### CR-171 [Low] The artifact GET crashes with a 500 on malformed `meta` JSON

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/artifacts/[id]/route.ts:8,12-14
- **What to do:** `JSON.parse(art.meta)` is still unguarded, so one corrupt `meta` row gives an unhandled 500. The row type is still an ad-hoc `Record<string, unknown>` instead of a `lib/db/rows.ts` mapper. Read through the existing `ArtifactRow` mapper (or add one with a safe JSON column parse) via an `ArtifactService.get(id)`.

### CR-115 [Medium] Row mappers bypassed: hand-written row interfaces and unvalidated `db.get/all` in the area

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/db/index.ts:10-25, lib/db/index.ts:885-889, lib/db/index.ts:913-917, lib/db/index.ts:929-935, lib/integrations/gitlab/client.ts:5-10, lib/integrations/gitlab/client.ts:182-184, lib/integrations/jira/service.ts:5-11, lib/integrations/jira/service.ts:27-29, lib/engine/runtime/worktree-lifecycle.ts:25-34, lib/engine/runtime/worktree-lifecycle.ts:314, lib/db/rows.ts:11, lib/db/rows.ts:43, lib/db/rows.ts:175
- **What to do:** These still bypass the row schemas: the hand-written `Repo` and `GitLabInstance` interfaces duplicate `RepoRow` and `GitLabInstanceRow` (the latter is still unused), `listMessages` returns `all<any>`, there are still no `JiraInstanceRow`, `WorktreeRemovalRow` or `SettingRow` schemas, `getSetting<T = any>` is still an unchecked cast, and `raw` columns stay `z.string()` despite the header comment. Fix: route these reads through `rows.get/all` with schemas, delete the duplicate interfaces, and make `getSetting` take a Zod schema.
- **Fix after:** CR-112 (this task)

### CR-113 [Medium] Missing indexes for hot queries

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** lib/db/schema.sql:20-37, lib/db/schema.sql:83, lib/db/schema.sql:114-131, lib/db/schema.sql:151-162, lib/db/schema.sql:299-302, lib/db/schema.sql:325-339
- **What to do:** No new indexes were added. `runs(node_id|flow_id|run_ref|status)`, `flows(parent_flow_id|gitlab_project_id|status|template_id)`, `plan_steps(sub_flow_id)`, `step_merges(flow_id)` and `hook_deliveries(created_at)` are still unindexed; `cursor_run_id` was renamed to `run_ref`. The redundant `UNIQUE(discussion_id, id)` on `comments` is still there. Fix: add `CREATE INDEX IF NOT EXISTS` statements; this is a schema change, so get approval first.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
