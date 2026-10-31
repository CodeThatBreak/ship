# Task 01: Hotfix: "latest" plan artifact returns an arbitrary (oldest) version

- **Phase:** Phase 0: Hotfix and quality gates
- **Depends on:** nothing, can start any time
- **Findings:** CR-270
- **Effort:** S

## Goal

`NodeSupport.artifactsOfKind` has no `ORDER BY`, so every "latest plan" read (build, step build, plan store, plan context) can act on plan v1 after the user approved vN. This is the highest-impact live bug and a one-query fix, so it goes first.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-270 [High] `NodeSupport.artifactsOfKind` has no `ORDER BY`, so "latest plan" reads return an arbitrary (oldest) version

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/shared/node-support.ts:120-149 (consumers: lib/engine/nodes/kinds/build/build-node.ts:175, 358, 412; lib/engine/nodes/kinds/build/step-build-node.ts:291; lib/engine/nodes/kinds/plan/plan-store.ts:32; lib/engine/nodes/kinds/plan/plan-context.ts:125)
- **What to do:** `artifactsOfKind` is documented as "newest first", but its SQL has no `ORDER BY a.version DESC`, so `latestArtifact(...)` returns the OLDEST version (checked against schema.sql in an in-memory DB: three plan versions give v1). Meanwhile `FlowEngine.latestResourceArtifact` (flow-engine.ts:903-910) orders correctly. As a result, approve marks vN approved while the build builds plan v1; `PlanStore.latestPlan` feeds stale v1 meta into turn routing, scoped refines and split units (a branch refine merges into v1 and drops later revisions); and the previous-versions context block shows the oldest three. Fix: add `ORDER BY a.version DESC, a.created_at DESC` to both branches (which are also identical apart from the bound param) and add a NodeSupport test with multiple versions.

## Additional steps

- Add `ORDER BY a.version DESC, a.created_at DESC` before the `LIMIT` in both branches of `artifactsOfKind`, and collapse the two identical branches into one query with an optional bound param.
- Add a `node-support.test.ts` case that saves three plan versions and asserts `latestArtifact` returns v3 and `artifactsOfKind` returns v3, v2, v1.

## Done when

- [ ] Approving plan vN builds vN (covered by the new test).
- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
