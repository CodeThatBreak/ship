# Step 02 working notes

Status: implementation complete — `npm run check` (typecheck + lint + test) and
`npm run build` green; smoke-verified against the demo DB (`next start` + API
probes on the seeded DEMO-142 flow and a freshly seeded DEMO-143 fan-out flow).

## End state (verified)

- `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 errors / 3 warnings — the
  untouched step-01 baseline (ChatComposerForm ×2, PlanPanelHeader ×1).
- `npm test`: 160 files pass / 1 skipped; 690 passed, **15 expected-fail**
  (step 00's 16 minus the step-02 flips), 3 skipped. Both step-02 flips green:
  `finishSplitOverwrite` (removed `test.fails`) and
  `noRawNodeStatusWrite` (removed `it.fails` + zero offenders, scan widened).
- Build green; `/api/flows/:id` payloads carry no `current_node`, nodes with
  statuses; the fan-out demo's derived highlight = the seeded `build:running`
  node (previously `currentNode: "build"`).

## What landed

- `lib/engine/runtime/transitions/`: `TransitionAuthority`
  (`nodeTransitions.ts` — claim/apply/applyOrThrow/applyFlowScope/
  transitionFenced/publishOutcome/publishAggregate/failFromRunning + the
  in-memory transition log), `TransitionEvents` (typed emission, EVENT_KIND
  catalog), `constants/transitionTable.ts` (~24 declared rows with actors),
  `constants/statusSets.ts` (predicate sets moved out of `nodeStatus.ts`),
  `constants/transitionMessages.ts`, `types/transitions.ts`,
  `utils/transitionLookup.ts` (pure vocabulary checks). Class-only class files,
  header docs everywhere, co-located tests: `transitionTable.test.ts`,
  `nodeTransitions.test.ts`, `transitionEvents.test.ts`.
- Every status writer migrated: flowEngine (finishFanout/finishSplit →
  publishAggregate, bg catch → failFromRunning, wrappers keyed),
  edgeActivator (loopReentry/skipBranch/stageError), sdlcChain
  (buildApprove/commitFix/commitFixHandback/mrHandback/manualStage/
  manualResolve — the `finally` overwrite is gone), stepFlowManager
  (mergeFixAwaiting/mergeBackFailed/mergeRetryAwaiting), splitManager
  (skipUnit bulk via applyFlowScope, approve), waitScheduler (armWait/resumeWait),
  nodeDefinition (`applyOutcome` → publishOutcome; markRunning now input-only),
  decisionNode (chooseBranch), planNode (chatRevert via `revertChat`), pipeline
  (touchNode liveness), mergeRequestService (gateReset), reconciler
  (`failOrphanedNode` moved onto FlowEngine, `activeAttempt` accessor).
  `NodeSupport.setNode` refuses `status`/`attempt_id` keys at runtime.
- De-singletonized (Q9): `nodeStore` + `nodeAttemptRegistry` lost
  `processSingleton`; `NodeSupport`'s instance moved to
  `lib/composition/container.ts` (`createEngineParts` + shared `engineParts`);
  the flowEngine processSingleton factory injects the parts. The
  `noProcessSingletonOutsideDb` freeze shrinks by those two entries.
- `flows.current_node` deleted: Prisma migration
  `20261118101658_drop_flow_current_node` (authored manually — the `devflow`
  role cannot create Prisma's shadow DB; deployed via `migrate deploy` +
  `prisma generate`), engine writers/pointers removed (~20 sites incl. the
  reconciler heuristic), UI derives the active node from `nodes.status`
  (cockpit selection, graph `runningKeys` highlight, chat busy, status bar),
  seeds/scripts updated, `lib/db/schema.sql` deleted (was unreferenced;
  `tests/seedDb.test.ts` inlined a scratch DDL — see flags).
- `FlowApprovalService` extracted to `lib/engine/flow/` (+ `types/approvalHost`,
  co-located test); flowEngine 1328 → 1214 lines. `engineClassSize` pins shrink;
  `nodeSupport.ts` left the giants list (446 < 450) and the classFilePurity
  freeze (now class-only); `nodeAttemptRegistry.ts` left the purity freeze.
- In-memory transition-log assert: `tests/helpers/transitionLogAssert.ts`,
  wired into `sdlcHappyPath`, `finishSplitOverwrite`, and the new
  `fanoutAggregatePublish` test (a real `finishFanout` drive).

## Key decisions

- **Aggregate fencing (the finishSplit fix, stronger than the doc's from-set):
  the step-00 characterization test cannot pass on a from-set alone — a
  re-claimed node is `running` again, so a stale aggregate would still win.
  `publishAggregate` is attempt-fenced with a three-way guard: bare callers
  publish only a `running` consumer (CR-009 — a published terminal is final);
  the runtimes pass the expand-time attempt token, so a re-claimed `running`
  node refuses stale aggregates, while the aggregate's own held/failed states
  (attempt cleared by its own publish) republish for the per-unit
  approve/retry actions. The attempt tokens live in manager maps
  (`consumerAttempts` / `aggregateAttempts`) — in-memory only; step 03's
  durable linkage replaces them.
- **Table rows mirror observed behavior, not just the diagram**: the diagram in
  target §2 lacks `manualStage`/`manualResolve`/`chatRefine`-style multi-source
  claims, `mergeRetryAwaiting` (failed → awaiting), `mergeFixAwaiting`, and
  `chatRevert`'s `approved` target (the plan's mid-build chat-guard refusal
  path). All declared with actors; `skipUnit`/`mergeBackFailed` deliberately
  exclude terminals (the old unconditional writes overwrote them).
- **`engineParts` is deliberately NOT process-pinned** (doc'd in the
  container): every part is stateless or DB-fenced, so per-module-graph copies
  cannot disagree; the attempt-registry liveness hint is only consulted
  through the pinned flowEngine instance (reconcile → `flowEngine.activeAttempt`).
- **Construction-cycle break**: `nodeStore.insertSnapshots` imports the node
  registry lazily — kinds import the composition root for the shared
  `nodeSupport`, so a static import would loop
  `composition → nodeStore → registry → kinds → composition` (it broke the
  suite at `PlanNode extends AgentRunNode` until made lazy).
- Direct-`expand` test fixtures now claim the consumer first (`engageConsumer`)
  — the production path is EdgeActivator's stage claim; the re-expansion
  fixture models the real loop re-entry (reset → re-claim → expand).
- `chatFirstTurn`/`planNode`/`mrTargetResolver`/etc. stub supports gained the
  authority delegates; `buildRunSupport` seed 43 mirrors the production
  precondition (a claimed `running` node before a refine turn).

## Flagged for the PR description (not fixed here)

- `oneClassPerFile`'s FROZEN_MISNAMED gained one entry —
  `transitions/nodeTransitions.ts` — because the step doc itself mandates that
  filename for `TransitionAuthority` (target-architecture §12 names the file);
  every other frozen list shrank or stayed equal.
- Residual race (documented, step 03/06 material): a stale aggregate arriving
  after the user CANCELLED a fan-out/split consumer can republish over the
  failed node (the aggregate's own failed state republishes with a cleared
  attempt — same signature as the per-unit retry path). The retry case — the
  one the characterization test pins — is fenced.
- `chatRevert` can target `approved`, but `chatRefine`'s from-set still
  excludes it (unchanged from the old sendChat claim set) — the approved-plan
  chat refusal is reachable only through node-level paths today; wiring an
  engine claim for it belongs to the step-06 trigger work.
- `AGENTS.md` §3.3's singleton wording flips with the step-09 consistency pass
  (target §11), not here.
- `ts-morph` (unused devDependency) and the `better-sqlite3` reader for
  `scripts/migrate-sqlite-to-pg.mjs` remain flagged from step 01.
- Pre-existing latent bug fixed in touched code: `approvePlan`'s override chip
  wrote `UPDATE artifacts SET … updated_at` — the artifacts table has no such
  column; the override path would have thrown at runtime. Now
  `UPDATE artifacts SET meta=…` only.
