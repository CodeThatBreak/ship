# Child-flow removal plan — fanout, split, and subflow

Status: proposed. Owner: TBD. Last updated: 2026-11-23.

## Decisions (locked with the requester)

1. **Remove all three child-flow runtimes** — fanout, split, **and** subflow. Subflow is not to be preserved or generalized; it goes with the rest. No decoupling refactor is needed (this removes the biggest risk identified during scoping).
2. **Fully clean schema.** Drop the child-flow tables, columns, relations, and enum values, coordinated with `lib/db/rows.ts` and landed as a Prisma migration. One documented exception: `flows.trigger_payload` stays, because it is also the general start-payload channel (see §"Schema exceptions").
3. Plan lives in this document.

## Scope in numbers

| Bucket | Files | LOC |
|---|---:|---:|
| `lib/engine/runtime/fanout/` | 25 | 3,158 |
| `lib/engine/runtime/split/` | 22 | 1,894 |
| `lib/engine/runtime/subflow/` | 10 | 576 |
| `lib/engine/nodes/kinds/subflow/` | — | 149 |
| Split source/consumer helpers + node ports | ~9 | ~430 |
| Fanout lint + merge-recovery + step-build def | 5 | 745 |
| Seed scripts + split fixture harness | 3 | 1,562 |
| Purpose-built frontend files | ~11 | ~1,120 |
| **Full-file deletions (subtotal)** | **~85** | **~9,600** |

Plus **~1,500 lines of embedded branches across ~35 shared files** (engine boot, flow engine, factories, read model, transitions, contracts, node defs, graph/cockpit/plan/template-editor/builder components, constants) and **~1,500+ lines of architecture docs** to rewrite or delete.

Net effect: the engine loses its entire child-flow orchestration layer (three expanders, three joins/rollups, three stage gates, the merge arena with git ops and a merge-fix agent, durable merge rows, and two recovery paths), plus the aggregate-publication machinery (`fanoutOutcome` / `splitOutcome` / `subflowOutcome` transitions and contract validation). The `StageGateRegistry` and the `onChildTerminal` effect lifecycle become completely unused and are removed.

## Sequencing principles

- One phase per PR; `npm run check` + `npm run build` green at the end of each.
- Delete whole files before editing shared files — the compiler then points at every remaining reference.
- No destructive git/file commands (AGENTS.md §1). Use a worktree for the series.
- Data-cleanup ordering hazard is handled explicitly in Phase 1 + Phase 6 (see below).

---

## Phase 0 — Baseline and data audit

- [ ] Create a worktree; record baseline `npm run check` and `npm run build` results.
- [ ] Confirm the target DB is the demo DB (`DATABASE_URL` ends in `devflow`, `NODE_ENV` is not production) before any seed/cleanup command — AGENTS.md §1.
- [ ] Query production-like counts (informational): rows in `flows` by `kind`, `step_merges`, `plan_steps` with `sub_flow_id`, and flows with `parent_flow_id`. These are the rows the schema migration must clean up.
- [ ] Snapshot the three architecture-test pins that will be rewritten/deleted: `tests/engine-overhaul/stageGateDispatch.test.ts`, `tests/engine-overhaul/subflowStageGate.test.ts`, `lib/engine/runtime/staging/stageGateRegistry.test.ts` ("built-in snapshot"), `tests/engine-overhaul/effectRegistrySnapshot.test.ts`, `lib/engine/runtime/effects/effectRegistry.test.ts`.

Exit: clean baseline, known data shape, known test pins.

## Phase 1 — Delete the runtimes and their node defs

Goal: remove the self-contained core; let TypeScript enumerate the fallout.

- [ ] Delete `lib/engine/runtime/fanout/` (25 files), `lib/engine/runtime/split/` (22), `lib/engine/runtime/subflow/` (10).
- [ ] Delete `lib/engine/nodes/kinds/subflow/` (149 LOC) — the declarative subflow node kind.
- [ ] Delete node/source ports: `kinds/plan/planSplit.ts`, `kinds/agent/agentSplitUnits.ts`, `kinds/agent/splitDirective.ts`, `nodes/shared/split.ts`, `nodes/shared/splitLookup.ts`, `nodes/shared/split/` (knobs + 2 typed errors).
- [ ] Delete `kinds/build/stepBuildNode.ts` (the `step_build` def), `runtime/reconcile/stepMergeRecovery.ts`.
- [ ] Delete the dedicated co-located tests that lived with those folders (`stepRollup.stepDiff.test.ts`, `splitExpander.test.ts`, `splitJoin.test.ts`, `buildRunSupport.test.ts`, `planSplitUnitsDemo.test.ts`, `splitSmokeTemplate.test.ts`, etc.).
- [ ] **Transient guard for the ordering hazard:** until Phase 6 deletes existing child rows, keep a temporary skip in `lib/engine/runtime/flowPoller.ts`, `lib/engine/runtime/commentIngestor.ts`, and `lib/engine/runtime/reconcile/runningHandler.ts` so rows with `kind !== 'sdlc'` are never picked up as normal flows. Remove this guard in Phase 6. (Alternative: delete child rows in a data-cleanup step before this phase ships — same PR or before deploy.)
- [ ] Do not run `npm run check` expecting green yet; use `npm run typecheck` to drive the reference cleanup in Phases 2–4.

Exit: the three runtime folders and node ports are gone; no live code path still imports them.

## Phase 2 — Engine integration, gate/effect infrastructure, API surface

- [ ] `lib/engine/flowEngine/flowEngine.ts` + `engineBoot.ts`: remove manager imports, `bind()` calls, `registerStageGates()` / `registerRuntimeEffects()` fanout/split/subflow registrations, `createStepChild` / `createSplitChild` / `isStepChild` facades, and the three unit-action methods (`approveFanoutStep`, `skipFanoutStep`, `retryFanoutStep`). Keep `registerDeclarativeEffects`.
- [ ] Remove the now-empty **`StageGateRegistry`** infrastructure: `lib/engine/runtime/staging/stageGateRegistry.ts`, its test, the `gates` field / `register`/`resolve` call in `stageRunner.ts`, and the `StageGateRegistry` type import in `engineBoot.ts`. (With all three gates gone, `resolve` always returns `"run"`.)
- [ ] Remove the **`onChildTerminal`** lifecycle: `effectLifecycles.ts` constant, the handler slot in `effects/types/nodeEffects.ts`, the dispatch in `stageRunner.ts`, and the wildcard registrations. `effectRegistry.ts` itself stays — declarative effects still use `EFFECT_KEY_ANY` with `afterApproval` / `afterSuccess`.
- [ ] `lib/engine/runtime/flowFactory.ts`: delete `createStepChild` / `createSplitChild` and their option types in `runtime/types/flowFactory.ts`; remove `mergeArena.isMerging` from `deleteFlow`; keep the generic `create()` path (it writes start payloads — see schema exceptions).
- [ ] `lib/engine/runtime/flowReadModel.ts`: remove `mergeStates` / `StepFlowManager.childRollup` and the `fanout` summary computation (also removes the `FlowSummary.fanout` data source).
- [ ] `lib/engine/runtime/contractPipeline.ts`, `transitions/nodeTransitions.ts`, `transitions/constants/transitionTable.ts`, `transitionMessages.ts`, `nodes/shared/schemas/defaultOutputs.ts`: remove fanout/split/subflow aggregate validation, `fanoutOutcome` / `splitOutcome` / `subflowOutcome` rows, messages, `DEFAULT_FANOUT_OUTPUT` / `DEFAULT_SPLIT_OUTPUT`. Keep the generic `publishAggregate` helper only if still used; otherwise delete it.
- [ ] `lib/engine/flow/`: remove `stepFlows` imports and step-child branches in `flowApprovalService.ts`, `flowPlanStepService.ts`; remove `isStepChild` from `types/approvalHost.ts`; clean the doc comment in `flowCancelService.ts`.
- [ ] `lib/engine/runtime/reconcile/`: remove step-merge recovery binding from `reconciler.ts`, the `step_merges` raw-SQL staleness query in `runningHandler.ts` and its allowlist entry in `eslint/rawSqlContainment.mjs`, `STEP_MERGE_GRACE_MS` in `constants/reconcileTiming.ts`, and the `parentFlowId` child-flow query in `runningHandler.ts`.
- [ ] `app/api/flows/[id]/action/route.ts`: remove all 7 fanout/split action cases and the `splitManager` import. Remove the matching Zod bodies in `lib/schemas/flowActionBody.ts` and the 7 `FLOW_ACTION` members + `FANOUT_STATE` in `constants/flow.ts`.
- [ ] `lib/engine/constants/flowKind.ts`, `lib/db/constants/rowStatuses.ts`, `lib/engine/constants/nodeKeys.ts` (`STEP_BUILD_TEMPLATE_ID`), `constants/nodeKind.ts` (`FANOUT_*`), `lib/engine/constants/flowChildTables.ts`, `lib/engine/runtime/flowFactory/utils/flowChildDeletes.ts`: remove child-flow kinds, step-build keys, and `step_merges` from deletion order.

Exit: no engine, API, or constant references to any of the three runtimes.

## Phase 3 — Node capabilities, config knobs, prompts, template lint

- [ ] `nodes/shared/capabilities.ts`: remove `mergeBack`, `fanoutOutput`, `splitOutput` slots; `nodes/shared/nodeDefinition.ts`: remove `splitUnits` / `splitResolution` / `childTemplateId` hooks; `nodes/shared/capabilities` client mirror in `types/nodeCapabilities.ts`.
- [ ] `nodes/kinds/build/buildNode.ts`: remove fanout config fields, `splitConsume` / `splitParallelMax`, `childTemplateId`, `fanoutOutput`; `buildTriggerPlanner.ts` and `utils/splitUnitItem.ts`: remove `unit` payload handling; `schema.ts`: remove split/step trigger payload schemas.
- [ ] `nodes/kinds/plan/planNode.ts`: remove `splitUnits` / `splitResolution` overrides and the `PlanSplitter` collaborator; `planContext.ts` / prompt builder: remove the execution/split directive and `{plan, step, siblings, unit}` variables.
- [ ] `nodes/kinds/agent/`: remove split config field constant + exports, declarative split schema block (`schemas/declarativeSchemas.ts`), and the split prompt directive in `agentPrompt.ts`.
- [ ] `kinds/review/reviewNode.ts`, `kinds/pipeline/pipelineNode.ts`, `kinds/resolve/resolveNode.ts`: remove `splitConsume` / `splitParallelMax` knobs.
- [ ] `templates/nodeConfig.ts`: remove `fanoutOf` / fanout config fields / split config fields / `stripFanoutKeys`; `lintContracts.ts`: remove `fanoutOf` output-field expansion; `lintRefs.ts`: remove `FANOUT_ROOTS`; `templateLint.ts`: stop calling `lintFanoutRules` / `lintAgentSplit` / `lintPlanExecution`; delete those three lint files and their tests.
- [ ] `lib/engine/prompts/promptDefaults.ts`: remove `step_build` and `merge_fix` prompts.
- [ ] `lib/engine/context/flowVariables.ts`: remove `{{plan}}`, `{{step.*}}`, `{{siblings}}`, `{{input.unit.*}}` aliases (keep the generic start-payload aliases).
- [ ] `lib/db/templateSeeder.ts`: remove the `nt_step_build` catalog row and the hidden `tpl_step_build` template. Add a **new** migration to delete existing seed rows (never edit historical migrations).
- [ ] `lib/engine/nodes/declarativePreviewPrompt.ts` / related preview tests: remove split/step preview branches.

Exit: no split/fanout capability, knob, prompt, lint rule, or seeded template remains in the node layer.

## Phase 4 — Frontend

- [ ] Delete purpose-built components: `FanoutStepList.tsx`, `FanoutStepCard.tsx`, `cockpit/fanoutProgress.ts`, `plan/components/PlanApproveFooter.tsx`, `plan/utils/planExecution.ts`, `SubPlanSection.tsx`, `SubPlanCard.tsx`, `SplitConfigFields.tsx`, `FanoutChildPicker.tsx`, `useGalleryTemplates.ts`, `panels/utils/stepDiffArtifact.ts`.
- [ ] Plan panel: `PlanView.tsx` (branch count, `resolveExecution`, `executionOverride` dispatch, footer), `types/planTypes.ts` (`BranchPlan`), `types/action.ts` (`executionOverride`), `constants/planConstants.ts` (execution mode/knob/source), `PlanSection.tsx` (sub-plan wrapper), and audit `PlanNodeChat.tsx` / `utils/branchDiff.ts` — keep the per-branch **refine** feature, drop only its split/fanout publication bits.
- [ ] Graph/cockpit/flows list: remove `fanout` props and aggregate card colors in `WorkflowGraph.tsx` / `NodeCard.tsx`; remove the `fanout` memo in `FlowCockpit.tsx`; delete the Fanout column in `FlowColumns.tsx`; remove step-child cost rollup in `FlowHeader.tsx`; update `types/flow.ts` (`PlanStepRow.subFlow`) and `types/flows.ts` (`FlowSummary.fanout`, `fanoutOf()`).
- [ ] Panels: `BuildView.tsx` (stop swapping to `FanoutStepList`, drop `ARTIFACT_META.FANOUT`), `panelFactory.tsx` (`step_build` mapping), `AgentView` Steps tab (`AgentTabs.tsx`, `useAgentView.ts`, `constants/tabs.ts`, `tabIcons.ts`), `artifactMeta.ts`, `DeleteFlowDialog.tsx` copy.
- [ ] Template editor/builder: remove `isPlanDownstream` gate and `configuringPlanDownstream` / `planDownstream` props (`types.ts`, `EditorPage.tsx`, `EditorNodeDrawer.tsx`, `ConfigTab.tsx`), fanout/split keys in `configFieldLogic.ts` + `configFieldKeys.ts`, the `fanout_child` renderer route in `SelectFieldRenderer.tsx`, and the comments in `NodeConfigurator.tsx` / `ConfigFieldRow.tsx`. `useFlowMutation.ts` stays generic.
- [ ] Update frontend tests: `tests/configFieldLogic.test.ts`, `tests/flowSummary.test.ts`, `tests/cockpitPanelState.test.ts`, `stepDiffArtifact.test.ts`.

Exit: no fanout/split UI, and no orphaned props/constants in shared components.

## Phase 5 — Scripts, docs, architecture allowlists

- [ ] Delete `scripts/seed-demo-fanout.mjs`, `scripts/seed-split-smoke.mjs`; trim `FANOUT_PLAN` from `scripts/demoPlanFixtures.mjs`; remove fanout/split cleanup from `scripts/lib/seed-db.mjs` and audit `scripts/migrate-sqlite-to-pg.mjs`; trim `scripts/seed-branch-refine-demo.mjs` split-units publication while keeping the branch-refine demo.
- [ ] Update `package.json` / `AGENTS.md` command and safety lists (the three seed scripts).
- [ ] Rewrite/delete docs: `README.md` (L84–92, 233, 350–353), `docs/architecture/build-node.md` (the fanout/split spec sections), `plan-node.md`, `flow-engine.md`, `templates.md`, `node-infra.md`, `database.md`, `git.md`, `resolve-node.md`, `review-node.md`, `pipeline-node.md`, `declarative-nodes.md`, `gitlab-integration.md`, `architecture/README.md`, `architecture/_template.md`, `docs/coding-patterns.md`.
- [ ] Remove stale lint/test allowlist entries: `eslint/frozenPhase0Offenders.mjs:12` (`step-flow-manager.ts`), `tests/architecture/oneClassPerFile.test.ts:52` (`planSplit.ts`), and the `rawSqlContainment.mjs` entry for `runningHandler.ts` from Phase 2.
- [ ] Flag pre-existing broken AGENTS.md references (`docs/engine-overhaul/target-architecture.md`, `docs/orm-migration/README.md`, `docs/review-tasks/`) in the PR description — they do not exist in this checkout and are out of scope.
- [ ] Delete/rewrite tests from scoping: `tests/engine-overhaul/{fanoutAggregatePublish,unvalidatedAggregate,finishSplitOverwrite,stageGateDispatch,subflowStageGate,completionTransaction,effectRegistrySnapshot}.test.ts`, `tests/demoSeedPlanFixtures.test.ts`, `tests/seedDb.test.ts` (step_merges cascade), `lib/engine/flowEngine.test.ts` (finishFanout regression), `nodeTransitions.test.ts` / `contractPipeline.test.ts` aggregate branches.

Exit: `npm test` green with no orphaned fixtures or stale allowlists.

## Phase 6 — Schema migration (gated on explicit sign-off)

Per AGENTS.md §1, ask before touching `prisma/schema.prisma`; land changes via `prisma migrate dev` and keep `lib/db/rows.ts` validators in lockstep.

- [ ] Data cleanup first: delete rows with `kind IN ('step','split')` (child flows), all `step_merges`, and clear `plan_steps.sub_flow_id`. Remove the transient poll/reconcile guard from Phase 1.
- [ ] `prisma/schema.prisma`:
  - [ ] `enum FlowKind` → `sdlc` only (Postgres cannot `DROP VALUE`; Prisma will regenerate the enum type — review the generated SQL and FKs carefully).
  - [ ] Drop `model StepMerge`, `enum StepMergeStatus`, all their relations and indexes.
  - [ ] Drop `flows.parent_flow_id` + `@@index([parentFlowId])` and the parent/child relations; drop `plan_steps.sub_flow_id` + its index and relation.
  - [ ] `enum JobKind`: drop `merge_back`.
  - [ ] Update `lib/db/rows.ts` (`FlowRow.kind`, `StepMergeRow`, zod validators) and `lib/db/constants/rowStatuses.ts` vocabularies.
- [ ] Verify `scripts/lib/seed-db.mjs` cascade list and `lib/engine/constants/flowChildTables.ts` no longer reference the dropped tables.

### Schema exceptions

- **Keep `flows.trigger_payload`.** It is written by the generic `create()` path (`flowFactory.ts:103`) and read by `startNode.ts:56`; `seed-custom-flow.mjs` writes `{}` and `stageRunner.ts:316` uses it for declarative delivery payloads. It is a general start-payload channel, not child-flow-specific. Removing it would be a separate change to the start-payload feature. Only the child-flow *aliases* (`plan`/`step`/`siblings`/`unit`) are removed in Phase 3.
- `FlowTemplate.hidden` stays — it is a generic gallery flag, not exclusive to the hidden step-build template.

Exit: a fresh `prisma migrate dev` + `npm run check` + `npm run build` pass against a clean demo DB.

## Phase 7 — Verification / Definition of Done (AGENTS.md §0)

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
- [ ] No new raw SQL outside the containment list; stale containment entries removed.
- [ ] Diff is focused: no unrelated reformatting or renames.
- [ ] Every async UI still has loading / error / empty states (removal should not leave broken skeletons in the graph or plan panel).
- [ ] New service classes and row mappers (if any) have tests — this plan should introduce none.
- [ ] Violations found in touched code are fixed; anything else flagged in the PR description.
- [ ] Grep gate: zero references to `stepFlows`, `splitManager`, `subflowFlows`, `FLOW_KIND.STEP`, `FLOW_KIND.SPLIT`, `fanout_mode`, `split_consume`, `approve_fanout_step`, `approve_split_unit`, `step_merges`, `tpl_step_build`.

## Estimated simplification

- **~9,600 LOC deleted outright** across ~85 files, plus ~1,500 lines of embedded branches in ~35 shared files and ~1,500+ lines of docs — roughly **12,000 lines** net reduction.
- Engine: three orchestration runtimes, three stage gates, the child-terminal effect lifecycle, the merge arena, two recovery paths, and one durable table disappear. The engine boot path shrinks from three gate registrations and four effect registrations to one effect registration and no gates.
- API: 7 action cases and their Zod bodies disappear.
- Frontend: an entire step-subflow monitoring stack and the plan execution-choice UI disappear; split had no runtime UI at all.
- Schema: one model, one enum, one job kind, two columns, two indexes, and several relations removed.

## Open risks

1. **Data cleanup ordering** — old child-flow rows must not be polled as normal flows between code removal and the migration. Handled by the Phase 1 transient guard; verify it actually covers all poll/reconcile entry points.
2. **Postgres enum recreation** — dropping enum values requires Prisma to rebuild `flow_kind`; review generated SQL, FKs, and defaults before applying.
3. **Branch-refine collateral** — it publishes split-units state in `seed-branch-refine-demo.mjs` and `planContext`; keep the refine feature while stripping only the split publication. Audit `components/flows/components/plan/` carefully.
4. **Pre-existing stale doc references** — AGENTS.md points at three missing docs; flag, do not silently fix.
