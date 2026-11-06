# Step 00 — Characterization tests

## Goal

Pin the engine's fragile seams with tests that assert **target** behavior (decision
Q4). Tests are written with `test.fails` (or marked `test.skip` where the harness or
column doesn't exist yet) so `npm test` stays green between steps while every broken
behavior is documented loudly. Each later step lists the markers it flips. This step
also builds the test harness for the four runtime modules that have **no tests
today**: `edgeActivator.ts`, `waitScheduler.ts`, `sdlcChain.ts`, `flowReconciler.ts`.

## Depends on

Nothing. Lands first.

## Files affected

- New: `tests/engine-overhaul/` — one file per seam (list below).
- New: `tests/helpers/flowHarness.ts` — engine-level fixture: creates a flow + node
  rows from a template graph, drives triggers synchronously, exposes
  `advanceUntilStatus()`. Uses fake ports (below), never real network.
- New: `tests/helpers/fakeGitHost.ts`, `tests/helpers/fakeAgentPort.ts` — in-memory
  implementations of `GitHostClient`/`AgentPort` registered into the registries for
  tests (the ports boundary already exists; tests just register fakes).
- Edit: `tests/helpers/inMemoryDb.ts` — rename to `testDatabase.ts` (it creates a
  temp-file DB, not in-memory), keep API, update importers. Real Postgres test
  wiring arrives in step 01 behind the same helper API.
- Edit: `vitest.config.ts` if needed to include `tests/engine-overhaul/**`.

## Concrete tasks

1. Test harness
   - `flowHarness.ts`: build a flow from the seeded SDLC template (or a minimal
     inline graph), seed node rows, return handles `{ flowId, engine, clock }`.
     Background work must be awaitable — expose `engine.runBackgroundForTest()` or
     drive `startNodeStage` directly.
   - Fake ports: `fakeAgentPort` records `start/followUp/cancel`, returns scripted
     `RunResult`s (finished/errored/missing); `fakeGitHost` scripts pipelines, MRs,
     comments.
2. Write the red tests (all `test.fails` unless noted; each tagged with its flip
   step, `// OVERHAUL: flip in step NN`):
   - `waitResume.test.ts` (**flip in 03**): webhook resume runs the node (currently
     the claim flips `waiting→running` and `startNodeStage` silently returns —
     `edgeActivator.ts:285`); timer resume runs the node; **restart case**
     (`test.skip` until `wait_until` exists — step 03).
   - `finishSplitOverwrite.test.ts` (**flip in 02**): a late unit cannot overwrite a
     node the user retried/cancelled (`flowEngine.ts:291-298` has no status
     precondition).
   - `unvalidatedAggregate.test.ts` (**flip in 04**): `finishFanout`/`finishSplit`
     contract failure ⇒ node `failed` + typed event, flow does **not** advance
     (today: publishes unvalidated, `flowEngine.ts:230/280`).
   - `recoverAbi.test.ts` (**flip in 05**): `recover()` never throws out of the
     reconciler for every kind — agent (re-parses without try/catch,
     `agentNode.ts:398-403`), decision (`decisionNode.ts:230-232`), and the
     always-false kinds.
   - `agentOutputFallbacks.test.ts` (**flip in 05**): review empty reply ⇒ `failed`
     (today silent done-with-0, `reviewNode.ts:177-190`); decision case-insensitive
     salvage removed (`decisionNode.ts:334-336`); script stdout scavenging removed
     (`scriptNode.ts:192-203`); agent markdown empty ⇒ `failed` (today
     `"(empty response)"`, `agentNode.ts:559`); build-progress missing with pending
     steps ⇒ loud failure (today silent `[]`, `planStepStore.ts:320-330`).
   - `pipelineGate.test.ts` (**flip in 05**): deadline timeout produces schema-valid
     `PipelineOutput` (today `output ?? {}` violates the declared schema,
     `pipelineNode.ts:529-546`); restart mid-wait resumes (`test.skip` until durable
     progress — step 05).
   - `duplicateTrigger.test.ts` (**flip in 06**): webhook + poller + manual trigger
     of the same node ⇒ exactly one run + one `skipped_duplicate_trigger` event
     (today: silent returns, no events).
   - `reconcileStates.test.ts` (**flip in 03**): `approved`-without-MR ⇒
     revert-or-adopt (today invisible to the reconciler, `flowReconciler.ts:97`);
     expired `waiting` fires; `awaiting_approval` with dead upstream fails.
   - `planRetryDeadEnd.test.ts` (**flip in 05**): Retry on a chat-only plan node
     replays the recorded turn or reverts to an actionable status
     (`docs/current-issue-plan.md` Issue 2).
   - `edgeConditionLint.test.ts` (**flip in 04**): template whose edge condition
     references a nonexistent output key is rejected by `lintDraft` / the validate
     route (today only JSONata syntax is checked, `templateLint.ts:397-403`).
   - `consumesValidation.test.ts` (**flip in 04**, `test.skip` until then): missing
     required upstream field ⇒ `failed` with typed error naming the producer.
3. Sanity (green) tests: SDLC happy path end-to-end with fake ports; plan chat turn →
   approve → build → gate; loop re-entry resets downstream terminals. These protect
   the migration in step 01 — they must pass identically before and after.
4. AST/architecture test scaffolding (decision Q6: tests, not ESLint rules):
   - `tests/architecture/noRawNodeStatusWrite.test.ts` — source-scan (the
     `serverOnlyPolicy.test.ts` pattern) asserting `UPDATE nodes SET status`
     appears only in the transition-authority module. Starts as `test.fails` with
     the known offender list; each offender's removal shrinks the list.
   - `tests/architecture/oneClassPerFile.test.ts` — one exported class per file in
     `lib/engine/**`, file named after the class.
   - `tests/architecture/engineClassSize.test.ts` — `lib/engine/**` files over 450
     lines fail, with a frozen allowlist of the current giants (`flowEngine`,
     `stepFlowManager`, `splitManager`, `pipelineNode`, `buildNode`,
     `resolveNode`, `edgeActivator`). The allowlist is append-only-frozen: steps
     remove entries as they decompose, nothing is ever added.
   - `tests/architecture/classFilePurity.test.ts` — a `lib/**` file exporting a
     class exports **only** that class: no module-scope `function` declarations,
     no module-scope runtime `const`/`let`, no exported `interface`/`type`.
     Frozen allowlist of current offenders (`sdlcChain` MANUAL_* consts,
     `hookStore` TTL consts, `buildNode` splitUnitItemOf, `flowEngine` helpers,
     plus the full scan result frozen in the PR) — shrink-only; **new files get
     zero tolerance** (not being in the allowlist = must pass).
   - `tests/architecture/domainFolders.test.ts` — within `lib/engine/**`
     non-test files: Zod schema definitions only in `schema.ts`/`schemas/`,
     exported types/interfaces only in `types/`, exported constants only in
     `constants/`. Frozen allowlist for the inline schemas in
     decision/http/script/agent nodes and `plan/schema.ts`'s `withStepIds` —
     shrink-only.

## Libraries used

None new. Vitest + existing helpers.

## Risks

- **Background work isn't awaitable** (`bg()` fire-and-forget): harness may need a
  test-only drain hook. Keep it minimal and test-only; do not refactor `bg()` here.
- **Singletons leak between tests** (processSingleton on globalThis): harness must
  reset registries/singletons per test file. If this fights back, isolate per
  `vitest --pool=forks` for this folder only.
- Over-fitting tests to current internals: assert at engine-API level (statuses,
  events, artifacts), never SQL or private methods — these tests must survive the
  step 01 migration unchanged.

## Acceptance criteria / tests

- `npm test` green with every red test carrying `test.fails`/`test.skip` + an
  `OVERHAUL: flip in step NN` tag.
- `rg "OVERHAUL: flip" tests/engine-overhaul` lists the full flip inventory; each
  step file's acceptance criteria references its subset.
- Harness can drive: trigger → run → outcome → advance, for both SDLC and a custom
  declarative template.
- Quality gates live: `oneClassPerFile`, `engineClassSize`, `classFilePurity` and
  `domainFolders` arch tests pass with their frozen allowlists (giants +
  inline-schema/loose-helper offenders) — documented as shrink-only.
- `npm run typecheck`, `npm run lint`, `npm run build` green.
