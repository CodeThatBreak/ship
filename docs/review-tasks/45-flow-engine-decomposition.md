# Task 45: Split the `FlowEngine` god class

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 44: Engine stores and status constants](44-engine-stores-and-constants.md)
- **Findings:** CR-070, CR-185
- **Effort:** L

## Goal

`flow-engine.ts` is 2,039 lines with about ten responsibilities and N+1 reads per poll. Extract `FlowFactory`, `FlowReadModel`, `EdgeActivator`, `WaitScheduler` and `CommentIngestor` behind a thin facade, one PR per extraction.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-070 [Medium] `FlowEngine` is a god class with about ten responsibilities in 1,800 lines

- **Status:** Open
- **Type:** Code quality
- **Effort:** L
- **Where:** lib/engine/flow-engine.ts:89-2039 (create/createStepChild/createSplitChild 95-285, get/list 358-535, plan-step editing 788-857, edge/join/skip machine 966-1163, wait timers 1290-1335 and 1904-1943, triggers/webhook starts 1757-1903, MR lookup and comment ingestion 1971-2039)
- **What to do:** The file grew from about 1,800 to 2,039 lines. Split-runtime proxies (skip/retry/approve/cancelSplitUnit, finishSplit) were added alongside the existing responsibilities. Only the SDLC chain, the split manager and the step-flow manager live outside it. Extract FlowFactory, FlowReadModel, EdgeActivator, WaitScheduler and CommentIngestor/MrLocator behind a thin facade, one per PR.

### CR-185 [Low] `FlowEngine.get()` performs N+1 queries per request

- **Status:** Open
- **Type:** Performance
- **Effort:** M
- **Where:** lib/engine/flow-engine.ts:358-503 (431,433 per-step child flow + nodes; 467-472 full node_templates scan with linear `find`; 498-500 per-node artifact query incl. `content`; 394 `stepFlows.mergeStates`)
- **What to do:** Unchanged from the reviewed commit. Only child runs are batched (one `IN` query), which was already true before. Each poll still runs two queries per step child and one per-node artifact query that selects full bodies, and searches node templates linearly. Batch child flows, child nodes and artifacts with `IN (...)` and group them in memory, index `ntRows` in a `Map`, and return artifact metadata only, lazy-loading content.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
