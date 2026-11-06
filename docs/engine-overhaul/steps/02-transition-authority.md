# Step 02 — Transition authority

## Goal

Invariant 1: **one transition authority.** Every `nodes.status` and `attempt_id`
write goes through a single module holding a declared transition table
(from-set → to-set, who may fire it), with attempt fencing on every later write.
The `NodeSupport.claim`/`NodeStore.claim` byte-identical duplicates collapse into
it. `flows.current_node` is deleted (decision Q5). Enforcement is a vitest
source-scan + an in-memory illegal-transition assert (decision Q6), so a raw write
or an undeclared transition fails the suite, not just code review.

## Depends on

Step 01 (writes are Prisma/Postgres; the authority is built once, on the new layer).
Step 00 provides the flip tests and the `noRawNodeStatusWrite` scaffold.

## Files affected

- New: `lib/engine/runtime/transitions/nodeTransitions.ts` — `TransitionAuthority`
  class (`claim`, `transition`, `publishOutcome`), the only writer. **Class only**
  (purity rule): the declared table lives in
  `transitions/constants/transitionTable.ts`, status predicate sets move from
  `nodeStatus.ts` into `transitions/constants/statusSets.ts`, and
  `TransitionKey`/`TransitionActor`/outcome types live in
  `transitions/types/transitions.ts`.
- New: `lib/engine/runtime/transitions/transitionEvents.ts` — typed lifecycle event
  emission from the authority (one place that speaks about status changes).
- Rewrite call sites (every raw/duplicate writer found in the audit):
  - `flowEngine.ts`: `finishFanout` (L236), `finishSplit` (L291), `bg()` catch
    (L402), `setNodeStatus`/`claimNode` wrappers (L375-387) — the wrappers survive
    only as thin delegates for one step, then inline to the authority.
  - `edgeActivator.ts`: stage catch (L382), loop-reset `setNodeStatus` (L121),
    skip propagation (L235).
  - `sdlcChain.ts`: L67/110/149 hard-sets — the `finally` overwrite is replaced by
    a declared effect claim (`approved → running` and back via outcomes).
  - `stepFlowManager.ts` (L903/923/985), `splitManager.ts` (`skipUnit` L616),
    `waitScheduler.ts` (`armNodeWait` L69).
  - `nodeSupport.ts` (`claim`/`transition`/`patchIfAttempt` funnel into the
    authority; the class keeps artifact/run/message helpers), `nodeStore.ts`
    (`claim`/`setStatus` deleted).
- Schema: Prisma migration dropping `flows.current_node`.
- UI: components reading `current_node` (`components/flows/**`, graph/highlight
  logic) derive the active node from `nodes.status === "running"` in the flow
  payload they already poll.
- Tests: `tests/architecture/noRawNodeStatusWrite.test.ts` flips to a hard pass
  with an empty offender list; new `transitionTable.test.ts`;
  `tests/helpers/` gains an in-memory transition-log assert for engine tests.

## Concrete tasks

1. Declare the table (mirrors the state diagram in `target-architecture.md` §2),
   including actor metadata (`trigger | effect | reconcile | user | system`) so
   tests can assert *who* fired a transition.
2. `TransitionAuthority.claim(flowId, nodeKey, key)` → conditional
   `UPDATE … WHERE status IN (from-set)` returning the attempt id;
   `transition(nodeId, attemptId, key, patch?)` fenced by attempt;
   `publishOutcome(nodeId, attemptId, outcome)` = validate output (delegates to the
   contract layer as a seam; wired fully in step 04) + terminal write in one
   statement.
3. Migrate every call site above. `finishSplit` gains its missing precondition via
   the table. The `bg()`/stage catches route through the authority's
   `failFromRunning`.
4. Delete `flows.current_node` (migration + UI derivation + remove the ~18
   set/clear call sites found in the audit, including the reconciler's heuristic
   clear at `flowReconciler.ts:82-83`).
5. Typed events: route all status-change events through `transitionEvents.ts`;
   replace the free-string `'lifecycle'`/`'error'` literals in `flowEngine.ts`
   with the `EVENT_KIND` catalog (found mixed usage in the audit).
6. In-memory assert: a test helper records the transition log per test and verifies
   every transition exists in the table (catches undeclared runtime paths the
   source-scan can't).
7. De-singleton this step's modules (Q9): `TransitionAuthority`, `nodeStore`,
   `nodeSupport`, `nodeAttemptRegistry` become constructor-injected from the
   composition root (steps 02+ are where these modules are rewritten anyway —
   no separate refactor pass). Shrink the `noProcessSingletonOutsideDb` allowlist
   accordingly. `nodeAttemptRegistry` loses its liveness role in step 03; here it
   becomes an instance field of the container-owned stage services, not a global.
8. Begin the `FlowEngine` carve-up (quality bar): extract `FlowApprovalService`
   (approvePlan/approveNode/approveBuild paths — they are being rewired through
   the authority in this step anyway) into `lib/engine/flow/`, header doc +
   co-located tests. The new `transitions/` module follows the layout in
   `target-architecture.md` §12 with header docs stating Invariant 1 ownership.

## Libraries used

None new.

## Risks

- **Hidden writers**: the audit found ~10 modules; a missed one fails the arch test
  loudly (that's the point) — fix forward in the same PR, don't carve exceptions.
- **`sdlcChain` `finally` semantics**: the unconditional "back to approved" hides
  real outcomes. Replacing it with declared claims changes failure surfaces — cover
  with the commit-fix characterization tests before touching.
- **UI regressions** from `current_node` removal: the graph highlight and flow-list
  subtitle must be checked against the derived status (visual smoke on the demo
  flow + the seed-fanout flow).
- Guard reads that used `setNodeStatus`-then-read ordering: the authority's writes
  are async now (step 01) — audit each call site for read-after-write assumptions.

## Acceptance criteria / tests

- `noRawNodeStatusWrite.test.ts` passes with **zero** offenders (arch test scans for
  `nodes SET status`, `attempt_id` writes, and `setStatus(` outside
  `lib/engine/runtime/transitions/`).
- `transitionTable.test.ts`: every declared from→to pair accepted; a sample of
  undeclared pairs (e.g. `pending → approved`, `done → running`) rejected.
- Flip from step 00: `finishSplitOverwrite.test.ts` goes green (remove
  `test.fails`).
- In-memory assert runs in at least the SDLC happy-path and fan-out tests.
- `current_node` absent from schema and UI; active-node highlight verified on the
  seeded demo flows.
- Quality: `flowEngine.ts` shrinks by the approval paths; `transitions/` classes
  all carry header docs; `engineClassSize` allowlist unchanged or smaller.
- `npm run check` + build green.
