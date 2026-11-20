# Step 07 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; 836 passed +
1 expected fail — the step-09 `noProcessSingletonOutsideDb` marker, still the
only one).

## What landed

- **EffectRegistry (Invariant 8)**: `lib/engine/runtime/effects/` —
  `EffectRegistry` keyed by `(defKey, lifecycle)` over the five declared
  lifecycles (`afterSuccess | afterFailure | afterApproval |
  onChildTerminal | loopReentry`), with `types/nodeEffects.ts` (the
  `NodeEffects` interface + `EffectCtx`) and
  `constants/effectLifecycles.ts` (the closed lifecycle set + the
  runtime-owned wildcard key `EFFECT_KEY_ANY`). Registered at engine boot
  (the FlowEngine constructor — one registry per engine instance, so tests
  constructing their own engine get their own dispatch scope).
- **`postTerminal` — the single post-terminal dispatch**: the StageRunner's
  `postTerminal` runs the registered `onChildTerminal` effects, then
  `afterSuccess` → `loopReentry` → falls through to the default edge walk;
  a failed outcome dispatches `afterFailure` and never advances (the
  pre-registry behavior). Every path that runs a stage inline outside
  `startNodeStage` (the chain's manual gate/review/resolve entries, the
  manual run, retry) funnels through the same dispatch — call ordering is
  gone from the chain's trigger bodies.
- **`sdlcEffects.ts` + slimmed `sdlcChain.ts`**: the SDLC chain's post-finish
  behavior is now four registrations — pipeline `afterSuccess` (gate green →
  the edges), review `afterSuccess` (review done → resolve-if-open), resolve
  `loopReentry` (re-gate via the loop join), build `afterApproval` (the
  MR-create sequence + the deferred build→gate advance — the CR-before-gate
  ordering is registry data, not call ordering). `approveBuild` slims to the
  `buildApprove` claim + the effect dispatch; the MR-create bg body moved
  verbatim into `SdlcChain.mrCreateSequence` (the effect implementation).
- **`onChildTerminal` registrations replace the sprinkles**: the fan-out and
  split runtimes register one `onChildTerminal` effect each under the
  runtime wildcard key (fanoutEffects.ts / splitEffects.ts) — the effects
  no-op without linkage, exactly the old `isStepChild`-guarded manager calls.
  The sprinkles are gone from `stageRunner` (both tails), `flowRetryService`
  and `cancelHandler` (which now takes the engine's registry); the manual
  run path dispatches through `postTerminal`.
- **Declared loop joins (task 5)**: `runtime/staging/LoopJoin` consumes a
  `LoopJoinDescriptor` (`{ when, resets }`) — `when` is the loop edge's
  lint-checked condition (step 04), `resets` is the declared reset set in
  `staging/constants/loopJoin.ts` (`SUCCESS_TERMINALS` + `SKIPPED_BRANCHES`,
  CR-007); the ad-hoc `statusLoopResettable` predicate is gone.
- **Staging decomposition (§12 table)**: `edgeActivator.ts` →
  `runtime/staging/` — `StageRunner` (thin orchestrator; renamed from
  EdgeActivator, host type renamed with it and `isStepChild` dropped from its
  surface), `InputMaterializer` (inherited input + the split unit ride),
  `ConditionEvaluator` (edge/loop JSONata, joins, skip propagation),
  `LoopJoin`. The stage runner carries no fan-out/split logic: the
  stage-start ownership gates moved INTO the runtimes (the fan-out gate owns
  the shadowed-split-knob trail event; the split gate — `stageGate` — owns
  the source resolution/nesting guard). The def-run cluster (`runNode` +
  `input_map` evaluation + the consumes check) moved into the StageRunner —
  its §1 responsibility row.
- **Fan-out decomposition**: `stepFlowManager.ts` 1369 → 306 (facade) +
  `StepFlowExpander` (422), `StepScheduler` (170), `StepRollup` (300 — owns
  the aggregate publication moved out of `flowEngine.finishFanout`),
  `MergeBackCoordinator` (344), `StepChildStore` (128), plus
  `fanout/{constants,types,utils}`. Every external call site unchanged (the
  facade keeps the public surface; `fanoutEffects` rides it).
- **Split decomposition**: `splitManager.ts` 734 → 217 (facade) +
  `SplitExpander` (264), `SplitJoin` (295 — owns the worst-of aggregate
  publication moved out of `flowEngine.finishSplit`), `SplitLinkageStore`
  (61 — absorbs `FlowsSplitLinkIndex`; the `SplitLinkIndex` interface moved
  to `types/`), plus `split/{constants,types,utils}`. The per-unit actions'
  consumer fallback moved into the runtime (`consumerFor`) — the action
  route drives `splitManager` directly.
- **Facade collapse (§12)**: `flowEngine.ts` 1094 → 449 — composition +
  thin delegation only: `runNode` → staging; `runNodeManual` → the new
  `flow/flowManualRunService.ts`; the deletion → `FlowFactory.deleteFlow`
  (FLOW_CHILD_TABLES → `constants/flowChildTables.ts`); the lookup cluster
  (ctx/graph/defKeyOf/role defs/config layers) → `FlowReadModel`; the
  fire-and-forget runner → `runtime/bgRunner.ts` (BgRunner); the five chain
  wrappers deleted — routes/poller/services drive `flowEngine.chain` and the
  public service fields (`approvals`/`chats`/`retries`/`planStepEdits`)
  directly; the schedule/wait delegate cluster collapsed into the public
  `waitsStore` accessor. `BgRunner`, `FlowManualRunService` carry header
  docs; the recovery seam (`completeNodeFromResult`/`failOrphanedNode`)
  moved INTO `RecoveryDriver` (the reconcile host narrows to ctx+defOf).
- **Tests**: new `effectRegistry.test.ts` (registration, exact+wildcard
  dispatch order, the double-boot guard, the `entries()` snapshot) +
  `tests/engine-overhaul/effectRegistrySnapshot.test.ts` — the SDLC
  template's exact effect set pinned (the executable answer to "what happens
  when X finishes?"). Co-located tests for every new fan-out/split class
  (describe blocks moved from the manager tests + delegation-seam coverage;
  shared split fixtures extracted to `tests/helpers/splitFixtureHarness.ts`).
  The recovery test drives the driver directly; the promptRetryRebuild
  characterization binds the retry service's strip step.
- **Allowlist shrink**: `engineClassSize` lost `flowEngine`,
  `stepFlowManager`, `splitManager` (entries + pins); `oneClassPerFile` lost
  `splitManager`. `classFilePurity`'s manager entries remain (the facades
  keep their sanctioned module-tail `processSingleton` export — see
  deviations). README's stale "advance interceptor" line rewritten (the
  chain lives at `nodes/chains/`, sequenced by registrations).

## Design calls worth knowing

- **Unclaimed lifecycles fall through to the edge walk.** The registry
  returns `claimed` when a registered effect ran; the runner advances via the
  template edges only when nothing claimed. The SDLC `afterSuccess`
  registrations delegate to `advanceFrom` themselves (the edges stay the
  actual stage-ordering data — target-architecture §13 keeps the template
  system), so the registrations NAME the chain's ownership of each
  post-finish concern and the snapshot pins them, without changing what the
  edges already expressed.
- **The wildcard key for the runtimes' `onChildTerminal`**: the doc keys
  effects by `(defKey, lifecycle)`, but fan-out/split children can run ANY
  node kind (declarative targets), so keying by defKey would miss them. The
  runtimes register under `EFFECT_KEY_ANY` and decide relevance via their own
  linkage lookup — byte-identical to the old unconditional
  `isStepChild`-guarded calls, and declarative-template parity is preserved
  by construction.
- **The stage-start gates stay runtime-owned, not registry lifecycles.** The
  five declared lifecycles have no before-run entry, and the doc fixes that
  set — so the fan-out/split EXPANSION gates moved into the runtimes
  (`StepFlowExpander.gate`, `SplitExpander.stageGate`) and the runner carries
  only two delegation calls. The registry owns everything post-finish; the
  "inline gates" (decision logic, the conflict rule's trail event, the source
  resolution) live with their runtimes now.
- **`postTerminal`'s dispatch order**: child-terminal notifications BEFORE
  the lifecycle effects (the old sprinkles ran before the advance); a
  claimed `afterSuccess`/`loopReentry` suppresses the default advance so the
  CR-before-gate ordering is enforceable by the build's `afterApproval`.
- **`afterApproval` fires from the chain's approve door** (the won
  `buildApprove` claim), not from the gateway's `transitionTrigger`
  generically: the generic `approveNode` path cannot reach a build node
  (`builtinApproval` rejects it), and firing effects for plan approvals /
  plan-retry reverts would be invention. The route to add more approval-door
  effects is the same dispatch (host.runEffect).
- **`flowEngine.effects` is per-engine** (not in the shared `EngineParts`):
  the effects close over THEIR engine's host, and tests that construct
  `new FlowEngine()` get a consistent dispatch scope instead of a
  duplicate-registration throw against a shared registry.

## Deviations / flags for review

- **`isStepChild` branches that remain (flagged, per the AC's spirit)**: the
  child-terminal sprinkles the step targets are gone; what remains is (a)
  the lookup definition on the facade (excepted by the AC), (b) the
  approval/retry ACTION ROUTING in `flowApprovalService`
  (approve-on-a-step-child = merge-back approve — an action address, not a
  "what happens after Y finishes" concern), and (c) the split runtime's own
  nesting guard inside `SplitExpander.stageGate` (split-domain logic,
  intentionally moved OUT of the stage runner with the gate). Both are
  runtime/action concerns the step's task list doesn't claim; flagged rather
  than forced.
- **The `engineClassSize` allowlist is down to six entries, not "at most
  buildNode"**: step 07 removed all three of ITS giants (flowEngine,
  stepFlowManager, splitManager). The remaining five (agentNode, planContract
  — step 05 deferrals; worktreeLifecycle — step 03; templateLint,
  templateStore — step 04 deferrals) predate this step and belong to their
  owning steps' deferred splits; decomposing them here would be a drive-by
  rewrite (AGENTS §4.3). Flagged for the step-09 consistency pass.
- **`classFilePurity` keeps the two facade entries** (`stepFlowManager.ts`,
  `splitManager.ts`): the facades retain their sanctioned module-tail
  `processSingleton` export (the frozen offender list already carried them;
  removing the entries would fail the exact-set assertion). The list did not
  grow — `FlowManualRunService`/`BgRunner` were made pure instead of
  allowlisted.
- **Stale plan-doc artifacts that didn't exist**: the step doc's
  `MANUAL_CHAIN_STAGE_FROM`/`MANUAL_RESOLVE_FROM` constants and the
  "advance interceptor" comment in `sdlcChain.ts` were not present in the
  current code (the from-sets live in the step-02 transition table; the
  interceptor reference survived only as stale README text, now rewritten).
  Nothing to move/delete — noted so the delta isn't read as an omission.
- **`flowEngine.finishFanout`/`finishSplit` deleted**: the publications moved
  verbatim into `StepRollup`/`SplitJoin` (their runtimes) and are reached
  only through the registry's `onChildTerminal` dispatch chain — their
  external callers (tests) drive the runtimes directly now.
- **`stepFlowManager` regrouping details**: `latestMergeRow` went to
  `StepChildStore` (its only consumer is the rollup's `stateOf`);
  `rollupInflight`/`scheduleRollup` live with the scheduler (the guard is
  meaningless detached from the scheduling point) and the rollup reaches it
  via constructor-injected callback; `FlowEngine.touch` is public (the moved
  aggregate publish heartbeats through the bound engine surface).
- **The cancel journal's child-terminal notify now routes through the
  registry** — `CancelHandler` takes the engine's `EffectRegistry` (the
  sweep's handler in `flowPoller` passes `flowEngine.effects`; a bare
  handler defaults to an empty registry = no-op dispatch, which keeps the
  cancel-journal tests hermetic).
- **`schedule`-source granularity gap carried from step 06** (the gateway
  vocabulary has `schedule` but the schedule fire's stage claims land as
  `effect`) — unchanged here; the effect ctx's `source` inherits the same
  threading.
- **Pre-existing typecheck errors fixed in `completionTransaction.test.ts`**
  (a Prisma delegate cast + a symbol index — present on the step-06 head
  after the client regen; needed for the DoD gate).
- **`npm test` tally**: 192 files, 836 passed + 1 expected fail
  (`noProcessSingletonOutsideDb` — the frozen marker owned by step 09).
