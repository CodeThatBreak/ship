# Task 27: Plan checklist edits keep step identity and order

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 12: Transaction API and atomic multi-writes](12-db-transactions.md); [Task 01: Hotfix: "latest" plan artifact returns an arbitrary (oldest) version](01-plan-artifact-ordering-hotfix.md)
- **Findings:** CR-013, CR-192, CR-097, CR-090, CR-084
- **Effort:** M

## Goal

A checklist bulk edit reopens done steps, drops `meta_id` (so the next refine duplicates the list) and reorders started steps. Plan artifact meta is read with casts. Update rows in place and parse meta with one schema.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-013 [High] Plan-checklist bulk edit reopens done steps and drops agent `meta_id`, so the next refine duplicates the checklist

- **Status:** Fixed (Task 27)
- **Type:** Bug
- **Effort:** M
- **Where:** lib/engine/runtime/plan-step-store.ts:142-197 (replace), 68-129 (syncFromPlan matches only origin='agent' by meta_id)
- **What to do:** `replace()` still deletes every row and re-inserts matched rows as `status='pending'`, `origin='user'`, keeping `meta_id` only for pending rows with a `sub_flow_id`. A Plan-editor retitle therefore reopens done steps and turns agent steps into user steps, which the next refine's `syncFromPlan` then duplicates. Update matched rows in place, carrying status, completed_by, origin, meta_id and sub_flow_id, and add a store test for edit followed by `syncFromPlan`.
- **Fix after:** CR-012 ([Task 12](12-db-transactions.md))

### CR-192 [Low] Checklist bulk replace moves protected (started) steps to the top

- **Status:** Fixed (Task 27)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/runtime/plan-step-store.ts:142-197 (176 `i + survivors.length`, 191 survivor position `i`)
- **What to do:** A bulk replace still re-inserts started (survivor) steps at positions 0..k-1 and shifts every edited row by `survivors.length`. Matched started rows are skipped in the main loop, so their input index is lost, and every bulk edit reorders the checklist with started steps first. Use the editor input index as the position for every matched row, survivors included, and append only unmatched survivors at the end.
- **Fix after:** CR-013 (this task)

### CR-097 [Low] Several plan-step and plan-validation gaps (cycles, id-less steps, wrong ids in the diff)

- **Status:** Partly fixed (Task 27) — scoped sub-plan event diff uses merged branch steps; id-less steps in `diffSteps` unchanged
- **Type:** Bug
- **Severity:** Low (was Medium)
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/plan/plan-contract.ts:356-357, lib/engine/nodes/kinds/plan/branch-refinement.ts:154-165, lib/engine/nodes/kinds/build/build-node.ts:213-227
- **What to do:** Branch `dependsOn` cycles are now rejected in `PlanResponse` (lib/engine/nodes/kinds/plan/schema.ts:123-135), and the patch path diffs against the merged steps. The full scoped sub-plan path still diffs `oldSteps` against the agent's raw `sub.steps` rather than the re-id'd `merged` branch steps, and `diffSteps` still drops id-less steps. Fix: diff against `merged.steps.filter(s => s.branch === branchName)`, the way `scopedPatchOutcome` does.

### CR-090 [Medium] Plan meta and step payloads are read from the DB with casts instead of Zod

- **Status:** Fixed (Task 27)
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/nodes/kinds/plan/plan-store.ts:31-51, lib/engine/nodes/kinds/build/build-node.ts:182-187, lib/engine/nodes/kinds/build/step-build-node.ts:266-286, lib/engine/nodes/declarative.ts:26-33
- **What to do:** `PlanStore.latestPlan` still casts `m.steps as PlanStep[]` and `m.branches`, bypassing the `PlanBranch` dependsOn defaults (`dependencySummaries` calls `branch.dependsOn.includes`). Build `triggerRuns` assigns `meta.branches` unchecked, step payloads are hand-coerced with `String(...)`, and `loadRow` silently turns corrupt config into `{}`. Fix: add a `PlanArtifactMeta` Zod schema (`z.array(PlanStep)`, `z.array(PlanBranch)`) safeParsed in `PlanStore.latestPlan` and reused by build/step-build. Ignore legacy artifact shapes.
- **Fix after:** NEW-C1

### CR-084 [Medium] The step-build context pack never shows sibling merge state or summaries

- **Status:** Fixed (Task 27)
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/build/step-build-node.ts:119, 151, 266-286, 301-316
- **What to do:** Unchanged. `payloadOf()` rebuilds siblings as `{id,title,files,status}`, and `contextPack()` then reads the stripped `mergeStatus`/`summary`, so live merge state and summaries never reach the prompt. Fix: one Zod `StepPayloadSchema` (siblings with optional mergeStatus/summary), parsed once and passed typed to `contextPack`.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
