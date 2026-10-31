# Task 22: Pipeline gate, review posting and resolve correctness

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 18: One terminal-status writer per node](18-terminal-outcome-writer.md)
- **Findings:** CR-075, CR-085, CR-086, CR-209
- **Effort:** M

## Goal

The pipeline gate can't tell API error from "no pipeline", review parsing is fragile and non-idempotent, and resolve marks comments resolved even when the host call failed.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-075 [Medium] Pipeline gate treats "stale head", "API error" and "no pipeline" as the same thing, so it triggers duplicate pipelines

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/nodes/kinds/pipeline/pipeline-node.ts:168-182, 354-388, 497-509
- **What to do:** Unchanged. `headPipeline()` still collapses API error (`.catch(() => null)`), no head pipeline, and stale sha into `null`. The fix-grace window only starts when `pipe != null`, so after a fix push (or a transient API error) the gate triggers an API pipeline immediately. Fix: return a discriminated `{kind: ok|stale|none|error}`, start `fixWaitStart` when `runFix` completes, and never trigger on `error` (back off instead).

### CR-085 [Medium] Review comment parsing is fragile and unvalidated, so reviews can post nothing or post "undefined"

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/review/review-node.ts:141-146, 155, 162
- **What to do:** Unchanged. The greedy `/\[[\s\S]*\]/` plus `JSON.parse` silently yields `[]` on any markdown brackets, and unvalidated items can post "undefined". Fix: use `extractJson` from json-schema-lite, validate with `z.array(z.object({file?, line?, body: z.string().min(1)}))`, and warn or fail when the response has no valid array.

### CR-086 [Medium] Review posting isn't idempotent: a retry or partial failure posts duplicate MR comments

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/nodes/kinds/review/review-node.ts:148-166
- **What to do:** Comments are still posted one by one inside `finalize`, with no record of what was posted. A partial failure followed by Retry re-posts everything. Fix: persist per-comment content hashes (artifact meta, or a table after schema sign-off) and skip already-posted hashes for this MR. Alternatively, save the artifact first and post from it in an idempotent step.
- **Fix after:** CR-085 (this task)

### CR-209 [Low] Resolve marks comments resolved unconditionally and hides git-host failures

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/resolve/resolve-node.ts:165-176; lib/engine/nodes/shared/node-support.ts:168-170
- **What to do:** The finalize step still marks every open comment `resolved`/`resolved_by='agent'` regardless of what the agent did (including when `codeChanged` is false). Git-host `resolveComment` failures are still swallowed with `.catch(() => {})`, so the DB says resolved while the MR thread stays open. Fix: mark a comment resolved only after the host call succeeds, otherwise keep it `open` and emit a warning. Optionally use the `resolving` status while the run is in flight.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
