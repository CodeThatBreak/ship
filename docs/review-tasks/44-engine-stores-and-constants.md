# Task 44: Engine stores and status constants

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 17: Atomic node claims and attempt identity](17-node-claim-and-attempts.md)
- **Findings:** CR-071, CR-180, CR-184, CR-217, CR-201, CR-181
- **Effort:** L

## Goal

Engine orchestrators still write ad-hoc SQL and raw status, event-kind and template-id literals, and two guards already disagree on whether `skipped` counts as started. Add `NodeStore`/`CommentStore` and backend status constants with named predicate sets.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-071 [Medium] Engine classes embed raw SQL instead of going through row mappers and stores

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** L
- **Where:** lib/engine/flow-engine.ts (51 raw db/rows calls; `SELECT id FROM nodes WHERE flow_id=? AND node_key=?` at 306, 347, 1011, 1121, 1301, 1361, 1931), lib/engine/runtime/fanout/step-flow-manager.ts (14 calls, e.g. 632, 739), lib/engine/runtime/flow-reconciler.ts:59-67,174 (9 calls), lib/engine/runtime/flow-poller.ts
- **What to do:** Node kinds now go through `NodeSupport` (lib/engine/nodes/shared/node-support.ts) and `PlanStore`. The "latest plan" query is down to two helpers: `NodeSupport.latestArtifact` and `FlowEngine.latestResourceArtifact`. The engine and runtime orchestrators still spell node status, id lookups and comment upserts as ad-hoc SQL. Remaining fix: a `NodeStore` (idOf/status/setStatus/claim) and a `CommentStore` backed by `rows.ts`, used in flow-engine, step-flow-manager and flow-reconciler.
- **Fix after:** NEW-C1

### CR-180 [Low] Status and flow-kind values are raw string literals throughout the engine

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/flow-engine.ts (58 status literals, e.g. 123,204,301,340-342,1707,1950); lib/engine/runtime/fanout/step-flow-manager.ts (67, e.g. 699,837,855-857,1006-1007,1160-1163,1194); lib/engine/runtime/flow-reconciler.ts (17); lib/engine/runtime/plan-step-store.ts (14, e.g. 161,222-223,260-262); lib/engine/runtime/flow-poller.ts:50
- **What to do:** The engine still uses raw status and flow-kind literals. Only the new `split-manager.ts` uses `FLOW_STATUS` and named status sets. The cited drift still exists: `deletableStepIds` (step-flow-manager.ts:1006-1007) treats `skipped` as not started, while `deletableGuard` (plan-step-store.ts:260-262) treats it as started. Add a server-safe `NODE_STATUS`/`FLOW_KIND` plus named predicate sets (`STARTED`, `TERMINAL_SUCCESS`), as split-manager already does, and use them, starting with the two diverging guards.

### CR-184 [Low] Duplicated logic inside `FlowEngine`

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:128-141,206-215,262-271 (node snapshot insert, now 3 copies incl. createSplitChild); 367-379 and 402-415 (run token rollup); 305-306,346-347,1011,1121,1301,1361,1931 and step-flow-manager.ts:632,739 (node-id lookup for events); flow-engine.ts:609+611 (`updated_at` written twice in `bg()`)
- **What to do:** The duplication has grown: the new `createSplitChild` copied the node-snapshot block a third time. Like `createStepChild`, it does not provision `wait_for: webhook` hooks the way `create()` does; it relies on `armNodeWait`'s `ensureForNode` instead. Extract `insertNodeSnapshots(flowId, graph, {provisionHooks})`, `runTokens(r)` and `emitNodeEvent(flowId, key, …)` (or `NodeStore.idOf`), and delete the duplicate `UPDATE flows SET updated_at` in `bg()`'s catch.

### CR-217 [Low] Domain magic strings in the DB layer (template ids, node keys, statuses)

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/db/index.ts:253,607-677 (7× 'tpl_sdlc_loop', 'tpl_step_build' at 670-677); lib/db/index.ts:391; lib/db/rows.ts:37,84,157,173,216,233,252,399
- **What to do:** The DB layer still hardcodes the template ids and node keys in SQL, even though `SDLC_TEMPLATE_ID` (templates/template-store.ts:44) and `STEP_BUILD_TEMPLATE_ID`/`NODE_KEYS` (engine/constants/node-keys.ts) now exist. Flow, branch, run, comment and step-merge statuses are still `z.string()` in `rows.ts` (only nodes use `z.enum(NODE_STATUSES)`). Fix: pass the existing constants as SQL parameters and add status `as const` maps used as `z.enum`.

### CR-201 [Low] Magic strings for statuses, artifact kinds, event kinds and pipeline states throughout the nodes

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/harness/agent-runner.ts:60,119,178,188; lib/engine/nodes/shared/node-support.ts:108,189; lib/engine/nodes/kinds/pipeline/pipeline-node.ts:328,418,427,441,469,474,516,534; lib/engine/nodes/kinds/build/build-node.ts:192,202,341,391,450; lib/engine/nodes/kinds/build/step-build-node.ts:191,226,254; lib/engine/nodes/kinds/merge-request/merge-request-service.ts:70,74,113,127,129; lib/engine/nodes/chains/sdlc-chain.ts:99,121; lib/engine/nodes/kinds/start/start-node.ts:34,74,78
- **What to do:** The chain now uses `NODE_KEYS` (via `keyOfRole`), and `FLOW_STATUS`/`NODE_RUN_STATUS` exist in `constants/flow.ts` (used by agent-node and split-manager). But roughly 100 raw node-status, run-status (`"finished"`), event-kind (`"lifecycle"`, `"mr_failed"`), pipeline-state (`"canceled"`) and `"default_model"` literals remain across the nodes and harness, and the start key `"start"` is still missing from `NODE_KEYS`. Fix: add backend `EVENT_KIND`/`RUN_STATUS`/`PIPELINE_STATUS`/`ARTIFACT_KIND`/`SETTING_KEY` constants, reuse `FLOW_STATUS`, add `START` to `NODE_KEYS`, and replace the literals.

### CR-181 [Low] Built-in def keys hard-coded as strings despite the "no node-key constants" design and the existing `NODE_KEYS`

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/templates/template-lint.ts:190,232
- **What to do:** The engine-side literals are gone. Approval ownership now goes through `def.builtinApproval` (flow-engine.ts:1539), the step child template comes from `parentDef.childTemplateId()` (step-flow-manager.ts:421-430), and roles go through `keyOfRole(NODE_KEYS.*)`. Two spots remain in template lint, `nt.key === "plan"` and `["plan","pipeline","review","resolve"].includes(...)`; replace them with `NODE_KEYS.*` or a registry capability query.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
