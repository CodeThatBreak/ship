# Step 07 — Effect/join layer

## Goal

Invariant 8: **single mechanism for "what happens after Y finishes."** The SDLC
chain's gate→review→resolve re-gate loop, fan-out roll-up, split completion, and
implicit orderings (CR-before-gate) become registrations in one `EffectRegistry`
the stage runner consults — not call ordering, `isStepChild()` sprinkles, raw
compensation writes, or a fictional "advance interceptor." Both runtimes (fan-out,
split) register into the layer; they are **not** merged (decision Q7).

## Depends on

Step 02 (transitions centralized — effects fire transitions), step 04 (join
conditions lint-backed), step 06 (trigger gateway — effects trigger through it).
Land after 06 so effects reuse the gateway/claim conventions.

## Files affected

- New: `lib/engine/runtime/effectRegistry.ts` — keyed by `(defKey, lifecycle)`:
  `afterSuccess | afterFailure | afterApproval | onChildTerminal | loopReentry`.
- New: `lib/engine/nodes/chains/sdlcEffects.ts` — the SDLC chain expressed as
  registrations (gate green → review; review done → resolve-if-open; build
  approval → MR-create ordering; resolve pushed → re-gate join).
- Edit: `lib/engine/runtime/edgeActivator.ts` — after a terminal outcome, consult
  the registry and run matching effects; delete the inline fan-out/split gates
  (L322-364) and the `isStepChild` child-terminal sprinkles (L390-405); the
  "predates the split runtime" comment goes away with the gates.
- Edit: `lib/engine/nodes/chains/sdlcChain.ts` — slimmed to effect implementations
  invoked via the registry (approveBuild's MR ordering becomes a declared
  `afterApproval` effect; the dead "advance interceptor" comment deleted).
- Edit: `stepFlowManager.ts`, `splitManager.ts` — expose `onChildTerminal` +
  roll-up effects for registration; `finishFanout`/`finishSplit` stay in their
  runtimes but are invoked only through the registry.
- Edit: `edgeActivator.ts` `resetLoopEntry` → driven by a declared join descriptor
  on the loop edge (`{ when, resets }`) instead of ad-hoc status writes; the
  seeded `pushed` condition is validated against the resolve output schema
  (lint from step 04) and interpreted here.
- Edit: `flowEngine.ts` — the ~15 thin chain delegating wrappers collapse: routes
  call the gateway/effect-aware engine API directly (`approveBuild` etc. become
  effect invocations, not engine methods).
- Tests: new `effectRegistry.test.ts` + a registry snapshot test for the SDLC
  template; loop re-entry and fan-out/split parity via the step-00 suite.

## Concrete tasks

1. Define `NodeEffects` interface + registration API; node kinds and runtimes
   register at boot (same pattern as `nodeRegistry`).
2. Stage runner: terminal outcome → `effects.run(lifecycle, ctx)` → effects trigger
   follow-on stages **through the TriggerGateway** (so effect-driven starts get the
   same claim/skip/event semantics as user clicks).
3. Port the SDLC chain: gate `afterSuccess` → review; review `afterSuccess` →
   resolve-if-open; build `afterApproval` → MR-create effect (declares the
   CR-before-gate ordering explicitly); resolve `loopReentry` → re-gate.
4. Port fan-out/split: `onChildTerminal` registrations replace the
   `isStepChild()` call-site sprinkles (the predicate itself may stay as a lookup,
   but no engine code branches on it).
5. Declared loop joins: the loop edge carries `{ when: <condition>, resets:
   downstream-terminals }`; `resetLoopEntry` consumes the descriptor; the schema
   link (condition → resolve output key) is enforced by step-04 lint.
6. Delete: inline fan-out/split gates in the stage runner, the "advance
   interceptor" doc comment, the thin `flowEngine` chain wrappers.
7. Registry snapshot test: for the seeded SDLC template, assert the exact effect
   set (this is the executable answer to "what happens when X finishes?").
8. Decomposition while porting (quality bar — the big one):
   - `edgeActivator.ts` → `lib/engine/runtime/staging/`: `StageRunner` (thin
     orchestrator), `InputMaterializer` (inheritance + consumes handoff),
     `ConditionEvaluator` (edge/loop JSONata), `LoopJoin` (declared resets).
   - `stepFlowManager.ts` (~1350) → `StepFlowExpander`, `StepScheduler`
     (parallel_max/file-overlap), `StepRollup` (finishFanout),
     `MergeBackCoordinator` (with `mergeArena`) under `runtime/fanout/`.
   - `splitManager.ts` (~700) → `SplitExpander`, `SplitJoin` (finishSplit),
     `SplitLinkageStore` under `runtime/split/`.
   - `FlowEngine` facade collapse: after approvals (step 02), chat/retry
     (step 05) and triggers (step 06) are carved out, the remaining facade is
     composition + read-model delegation only (~200 lines). Its god-class
     findings (CR-070/CR-185, review task 45) close here.
   - Every new class: header doc (role, invariants, must-never) + co-located
     test; the `engineClassSize` allowlist loses `edgeActivator`,
     `stepFlowManager`, `splitManager`, `flowEngine`.
   - Purity rule: `sdlcChain.ts`'s `MANUAL_CHAIN_STAGE_FROM`/`MANUAL_RESOLVE_FROM`
     move to `nodes/chains/constants/`; effect lifecycle kinds, join descriptors
     and fan-out/split tuning values land in `effects/constants|types/`,
     `fanout/constants|types/`, `split/constants|types/` — shrinking the
     `classFilePurity` allowlist.

## Libraries used

None new.

## Risks

- **Ordering parity**: today's behavior is call-ordering luck in places
  (CR-before-gate). Port one lifecycle at a time, parity-checked by the SDLC
  happy-path and fan-out/split characterization tests after each.
- **Effect re-entrancy**: an effect that triggers a stage which fires effects must
  not recurse unboundedly — effects run depth-first with the same claim fencing;
  the loop-join path is covered by the existing loop characterization test.
- **Registry becoming a second god-object**: effects are data (registrations),
  not a place to park logic; implementations stay in their owning modules
  (`sdlcEffects`, fan-out/split managers).
- Custom templates with no SDLC nodes must end up with an empty effect set and
  behave exactly as today — parity test on a declarative template.

## Acceptance criteria / tests

- `effectRegistry.test.ts`: registration, lifecycle dispatch, effect-driven
  triggers flow through the gateway (skip events included).
- Registry snapshot test for the SDLC template pins gate→review→resolve→re-gate
  and the CR-before-gate `afterApproval`.
- Parity: full step-00 suite (SDLC happy path, fan-out, split, loop reset) green;
  `rg "isStepChild" lib/engine` shows no engine branching (lookup definition
  excepted); "advance interceptor" comment gone.
- Quality: `engineClassSize` allowlist is empty or down to at most `buildNode`
  (with a documented note); `oneClassPerFile` green across `lib/engine/**`;
  `runtime/` matches the §12 target layout.
- `npm run check` + build green.
