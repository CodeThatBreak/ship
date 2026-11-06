# Overhaul prompt: make the DevFlow flow engine non-fragile

You are a senior engineer performing a structural overhaul of the flow engine in
the DevFlow repo (Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4,
TanStack Query, better-sqlite3). Read `AGENTS.md`, `README.md`,
`docs/coding-patterns.md`, and `docs/review-tasks/README.md` first and follow the
repo's conventions (**OOP service classes, Zod at boundaries, guarded DB writes,
Early checks over `??` fallbacks, focused diffs, `npm run check` green**).

**Goal:** The engine currently "works" only when nothing goes wrong. It must
become a system with one mental model where (a) every state transition is
enforced in one place, (b) agent output can never silently corrupt or bypass the
flow, (c) any failure — agent lies, malformed output, process restart, concurrent
trigger, remote API failure — resumes or recovers cleanly and loudly, never
leaving the flow stuck or silently proceeding.

---

## Part 1 — The diagnosis (verified evidence)

These are the reasons the current engine is fragile. Fix them; do not retrofit
around them.

### 1. Two parallel state-transition systems

- The engine has a guarded, atomic path for node kinds:
  `claim()` / `transition()` / `patchIfAttempt()` built on the `attempt_id`
  supersede fence (`lib/engine/nodes/shared/nodeSupport.ts`,
  `lib/engine/runtime/nodeStore.ts` — note `NodeSupport.claim` and
  `NodeStore.claim` are byte-identical duplicates that will drift).
- But the engine's own bookkeeping bypasses it with raw, unguarded
  `UPDATE nodes SET status=…` writes or unconditional `setNodeStatus()`:
  - `flowEngine.ts` `finishFanout` (~L236) and `finishSplit` (~L291) — the
    latter has **no status precondition at all**, so a late unit can overwrite a
    node the user already retried or cancelled.
  - `flowEngine.ts` `bg()` catch (~L402) raw `status='failed'`.
  - `edgeActivator.ts` stage catch (~L382) raw `status='failed'`.
  - `sdlcChain.ts` hard-sets build to `'approved'`/~`'awaiting_approval'`,
    including a `finally` block that **overwrites whatever the build's own run
    produced**.
  - `runtime/fanout/stepFlowManager.ts` (~L903/923/985) and
    `runtime/split/splitManager.ts` (~L616) raw writes.
- `flows.current_node` is a separate heuristic-maintained pointer set/cleared
  from ~8 call sites with no ordering invariant.

### 2. The `waiting → resume` contract is a silent no-op (worst single bug)

`lib/engine/runtime/waitScheduler.ts`:
`resumeNodeFromWebhook` (L139–156) and `fireWaitTimer` (L158–175) both
**claim the node first** (`claimNode(…, ["waiting"])` — flips status to
`running`), then call `startNodeStage({ resumeWaiting: true })`. But the stage's
first guard (`edgeActivator.ts` ~L285) is
`if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;`
— since the claim already flipped it to `running`, the guard returns silently.
Net effect: a webhook/timer resume claims the node, starts **nothing**, emits no
error, and the node sits stuck in `running` until the reconciler's 180s grace
window fails it. No test covers either resume path. This is exactly the class of
bug the overhaul must make impossible.

Consequences that follow from the same design: wait deadlines live in an
in-memory `WaitScheduler.waitTimers` Map; on restart they are re-armed from
`nodes.updated_at` heuristics (a debounce in-progress resets its full quiet
period). The durable `wait_until` column was deferred (review-task CR-006).

### 3. Cross-node output contracts are advisory

- `NodeDefinition.applyOutcome` validates a node's output against **its own**
  Zod `outputSchema` — nothing validates it against what **downstream nodes'
  input maps actually need**.
- Inherited input is built by `Object.assign`-merging all parent outputs
  (`edgeActivator.ts` ~L44) — silent "last wins" field overriding.
- `finishFanout` / `finishSplit` catch their aggregate's output-contract failure
  and **publish it unvalidated**
  (`flowEngine.ts` L230/L280: "the fan-out aggregate failed its output contract
  — publishing it unvalidated"), and the flow advances anyway.
- `lib/engine/nodes/kinds/agent/jsonSchemaLite.ts` validates only a
  non-recursive subset, and `http`/`script`/`decision` declare `z.looseObject({})`
  — "validated" is vacuous there.
- The loop-edge resolve condition `nodes.resolve.output.pushed = true` is a
  JSONata **string literal living in seed/template data**, coupled across a DB
  row to the resolve node's output shape with no build-time link
  (`scripts`/template YAML fixtures).
- Loop re-entry (`resetLoopEntry`) resets terminals to `pending`; `nodes.output`
  is a single mutable column with no per-attempt history — the last writer wins
  for every later edge evaluation.

### 4. Per-node agent-output handling is inconsistent — each node a different convention

One standard exists (`AgentOutputError` with `no_json | schema_mismatch |
agent_reported`, a RESPONSE FORMAT directive, and one bounded feedback retry),
but half the node kinds don't use it:

| Node | Contract | On violation |
|---|---|---|
| `plan` (`planNode.ts`, `planContract.ts`, `schema.ts`) | JSON turn envelope + Zod superRefine | 1 retry → refusal + status revert — but also: unparseable plan-meta **degrades to an empty meta** (`planStore.latestPlan`), missing step ids are **fabricated** positionally (`withStepIds` → s1, s2…), missing/unknown `execution` ⇒ silently `whole` |
| `build` (`buildNode.ts`, `runtime/planStepStore.ts`) | **markdown fence convention** ```` ```json build-progress ```` in agent prose | missing/unparseable block ⇒ **steals `[]`, build silently proceeds to `awaiting_approval` with zero check-offs and no event**; `markDone` also matches steps by case-insensitive title so the agent can spuriously complete steps; corrupt plan artifact meta ⇒ `catch { /* single-branch fallback */ }` silently rewrites a multi-branch plan to single-branch; build chats with no prior agent ⇒ silently starts a full build with `(plan?.content ?? "")` as the prompt |
| `review` (`reviewNode.ts` L177–190) | prose "return a JSON array" | unparseable-but-nonempty ⇒ failed; **empty agent reply ⇒ silent `done` with 0 comments**; inline post failure degrades to an MR note and proceeds; declared output is just `{comments: number}` — the real product (posted comment hashes) lives in artifact meta ad-hoc-parsed, and resolve doesn't read it |
| `decision` (`decisionNode.ts`) | hand-written prose `{"choice","rationale"}` — **no AgentOutputError directive, no envelope** | hand-rolled parse throws plain `Error`s (loses the standard payload), case-insensitive label **salvage** ("normalize instead of failing"), zero bounded retries — user-facing manual retry |
| `pipeline` (`pipelineNode.ts` L529–547) | no contract for the gate itself | the deadline branch falls back to `output ?? {}`, but `PipelineOutput` **requires** `pipelineId/status/fixes` ⇒ when no pipeline was ever observed the intended graceful timeout **crashes in `outputSchema.parse`** instead. Also a synchronous in-`run()` poll loop (up to 80 min, `for(;;)`, ~8 local mutable loop vars); recover() is always `false` so a restart throws away wait progress and any in-flight fix agent run |
| `agent` (declarative) | standard | correct (1 retry → `AgentOutputError`) — **except** markdown mode silently rewrites an empty agent response to `"(empty response)"` and completes the node as done, and `recover()` re-parses **without try/catch** so a bad recorded result throws out of recovery instead of failing cleanly |
| `resolve` (`resolveNode.ts`, `resolveContract.ts`) | standard + semantic coverage | correct — bounded retry, `agent_reported` propagates, `PUSH_STATE.UNKNOWN` refuses to guess. Its recovery, however, silently re-applies effects with an **empty ledger** when artifact meta fails to parse |
| `script` (`scriptNode.ts` L184–204) | `$DEVFLOW_OUTPUT` file | on failure it **scavenges the last 8 stdout lines** for anything JSON-parseable — a debug `{"foo": 1}` log becomes the node's output |

Other silent seams: `review`'s `recover` always `false` despite an existing
`postedHashes` idempotency ledger it doesn't use; http's JSON-parse fallback
swallows with no event; build's unvalidated cross-node read
`planOutput?.model ?? undefined`; the `splitUnitItemOf` helper hand-narrows the
split trigger payload with silent defaults.

### 5. `recover()` has no enforced contract

The documented convention is "persistence-only recovery; return `false` to fail
for manual retry". In practice: `agent`/`decision` recover **throws** (and
`flowEngine.completeNodeFromResult` calls `def.recover` with **no try/catch**, so
the exception escapes into the reconciler), `plan` swallows bad recorded input
with `PlanInput.parse({})` and proceeds, `build` **guesses a branch**
(`reportedBranch ?? flowBranch`) and publishes `awaiting_approval` against
whatever branch it guessed, `resolve` widens its effects on an unreadable
ledger, and `pipeline`/`review`/`http`/`script` are always `false`. The
reconciler only interviews nodes with `status='running'` — a crash in
`approveBuild` between "node approved" and MR creation + gate advance leaves
**`approved` with no MR and no gate**, a state no reconciler ever sees.

### 6. Half-apply windows and check-then-act coordination

Concrete sequences with interleaved external I/O and DB writes, no transactions
and no idempotency: MR create → `flows` row update
(`mergeRequestService.create`) — retry does look up the existing MR, but the
flow is blind until then; `saveArtifact` supersede-then-insert; `cancelNode`
(remote cancel → runs → node transition); `registerStartupRun` placeholder
upgrade dance; webhook route marks delivery seen **after** dispatch (a crash ⇒
duplicate flow on redelivery; the catch path never marks ⇒ GitLab retries
forever); schedule ticks advance `schedule_next_at` **before** firing (a crash
drops that fire). Coordination is a patchwork of status reads (`nodeRunning`,
`chainBusy` — read-then-act TOCTOU), `globalThis`-pinned in-process Maps
(`nodeAttemptRegistry`, `waitTimers`, `mergeArena` locks, reconciler throttles)
and 90s/180s grace heuristics. Running **two server processes against one DB
actively corrupts each other**; the current mitigation is a runbook line in
`docs/current-issue-plan.md` ("keep exactly one server running") — a
documentation rule as load-bearing correctness.

Also: "aliveness" is encoded by **stamping `nodes.updated_at`** (pipeline gate
heartbeat ~L548–551, `WorktreeManager.touchNode`) — the same column that is the
wait-re-arm base and the reconciler's stale-window base. Heartbeats skew these
heuristics.

### 7. The documented architecture doesn't match the code

- `sdlcChain.ts` comments describe an "advance interceptor" hook; **no such
  mechanism exists** — the CR-before-gate ordering invariant survives only
  because of call ordering inside one method.
- The builtin/SDLC-vs-custom duality and fan-out-vs-split-edge special cases
  (`isStepChild()` sprinkled through `flowEngine.approveBuild/approveNode/…`,
  inline fan-out gates inside the stage runner with a comment admitting the
  plan-step fan-out "predates the split runtime and is not migrated") mean node
  behavior is partly defined by interceptors, partly by node classes, partly by
  template data — no single place answers "what happens when X finishes?".
- README/seed fixtures still sell a markdown `plan-meta` block; the parser only
  consumes the JSON turn envelope. `planNode.ts` even carries
  `// Todo: … only one source of truth for main agent id`.

### 8. The agent has no self-repair surface

Agents can't see or fix flow state: ports expose only
`start/followUp/getRun/cancel/stream`; context is a server-compiled prompt
snapshot at T-0 (no MCP/tool registration anywhere). All repair is human:
`failed` status + error event + Retry buttons. The documented dead-end proves
the loop breaks: `docs/current-issue-plan.md` Issue 2 — the plan node's `run()`
throws by design ("only accepts input via POST …/chat"), the reconciler fails a
stuck plan node, and **the UI Retry button re-fails it forever** because there
is no recorded turn to replay unless a human happened to type in the plan chat.

---

## Part 2 — Target design: the mental model

Implement these invariants literally. They are the acceptance criteria.

1. **One transition authority.** Every change to `nodes.status` goes through a
   single guarded transition layer with a declared transition table
   (from-set → to-set, attempt fencing). Deleting/replacing is fine; two systems
   is not. Enforce with a lint/AST test that fails on raw `UPDATE nodes SET
   status` outside the transition module, and an in-memory transition-list
   assert (fail tests on illegal transitions). The transition layer is also the
   only writer of `attempt_id`, and `NodeSupport`/`NodeStore` conflate into one.
2. **Durable, origin-agnostic state.** All scheduling/truth lives in the DB:
   - `nodes.wait_until` column for webhook/timer/debounce waits (set when the
     wait arms, re-read by ticks — no restart re-arm heuristics from
     `updated_at`).
   - A run lease per in-flight execution (`runs.row` + lease expiry/heartbeat
     column, not `updated_at` stamping) so the reconciler asks "is the lease
     current or expired?" instead of "is a timestamp fresh?".
   - Nothing correctness-critical in `globalThis` maps: they're at most caches
     already in the DB.
3. **Reconcile all non-terminal states, not just `running`.** A reconciliation
   pass walks every node in `running | awaiting_approval | approved | waiting`
   and drives it to a terminal-or-actionable state: `approved`-without-MR ⇒
   re-create/adopt the MR or revert to `awaiting_approval` with an event;
   `waiting`-expired ⇒ fire the wait; `awaiting_approval` with a dead upstream ⇒
   marked failed. Idempotent, safe under repeated invocation.
4. **A fixed `recover()` ABI:** `recover(ctx, node, result) →
   {status: "recovered" | "manual" | ...}` result object, **never throws**
   (single try/catch in the driver maps a throw to `manual` + event). No node
   guesses during recovery: `build`/`plan`/`resolve` must verify state
   (branch/tag/log ledger) before publishing anything, exactly like `resolve`'s
   `PUSH_STATE.UNKNOWN` — the best pattern in the tree — rather than guessing a
   default.
5. **Contracts all the way down.** Every node kind declares (a) its
   `outputSchema`, and (b) a `consumes` contract: a Zod schema for the subset of
   upstream output/input-map fields it needs. At stage start the engine
   validates the materialized input against `consumes` and fails loudly with a
   typed error naming the missing field and the producing node — **behaviour
   default: refuse to proceed** (no silent `??` default). Conversely the engine
   must NOT publish anything unvalidated: the `finishFanout`/`finishSplit`
   "publishing it unvalidated" escape becomes: validate → on failure set the
   node `failed` with a precise contract error event (retriable), never advance
   on unvalidated data. Replace `jsonSchemaLite` with real Zod schemas for
   declarative nodes.
6. **One agent-output pipeline.** All agent-emitting nodes (agent, plan, build
   progress, review comments, decision, resolve, fix agents) go through one
   component owning: parsing (JSON-envelope extraction via the existing
   `extractJson`), validation against the node's declared contract, the
   `output_error` envelope, a configurable bounded retry budget per node, and
   emit-on-every-outcome (success, retry, exhaust, agent-reported) as typed
   events. Missing output is a **first-class distinguishable state** — never a
   default: no `(empty response)` fabrication, no `markDone` title-matching, no
   review "empty ⇒ silent done with 0 comments", no script stdout scavenging
   (if the script has no declared output contract the node finishes with
   `output_contract_violation` event and fails). Node-level output *shape*
   differences are allowed; the fallback language is not.
7. **Complete state writes.** Any sequence that persists more than one row
   around external I/O is either one SQLite transaction (pure-DB parts) or
   externally-idempotent with a durable journal (job/delivery rows claimed atomically
   with `UPDATE … WHERE status='queued'` + lease before dispatch — write-ahead
   marking for webhook deliveries; schedule fires as claimable job rows).
   A crash is permitted to leave state **durable-but-unfinished** (reconciler
   finishes it), never durable-but-wrong (published unvalidated, node approved
   with no MR).
8. **Single mechanism for "what happens after Y finishes".** The SDLC chain's
   gate→review→resolve re-gate loop, fan-out roll-up, split completion, and any
   implicit ordering (CR-before-gate) must be declared in one abstraction
   layer the engine reads — a real interceptor/effect table keyed by node kind
   and lifecycle — not scattered across call ordering, `isStepChild()` sprinkles,
   raw status compensation, and template-data edge literals. The
   `nodes.resolve.output.pushed = true` loop condition must become
   schema/template lint-checked (an output key referenced by an edge condition
   must exist in the producing node's output schema — add this to the template
   lint and the `/api/templates/[id]/validate` route).
9. **Deep progress = durable counts.** The pipeline gate's in-run loop variables
   (`fixes`, `manualPlays`, attempts) must persist (node row / artifact meta
   with schema) so a restart resumes the wait instead of discarding progress.
   Pipeline timeout must
   emit its graceful failed outcome with a **fully-populated or explicitly
   contract-compatible** output (typed `PipelineOutput.safeParse` before
   `applyOutcome`), never crash inside a schema.
10. **Agents get eyes and hands.** Give running agents a minimal, authenticated
    read/repair surface so a misstep can self-correct:
    - Read: a tool/MCP-style endpoint per flow that returns node statuses,
      open checklist steps, open comments, pipeline state (the same facts the
      compiled prompt snapshot carries — but queryable at T+5min).
    - Write: at minimum checklist progress can be claimed/asserted via API
      (replacing the prose `build-progress` fence as the *authoritative* source,
      keeping the fence as a fallback that logs an event), and a bounded
      `report_failure` action that marks the node failed with the agent's
      reason — no mutation of unrelated nodes, capability-gated per node kind.
11. **Consistent trigger semantics.** Duplicate triggers (webhook + poller +
    user click) are refused by the atomic claim — the loser always emits a
    typed `skipped_duplicate_trigger` event at debug level, never silently
    returns. `triggerPipelineGate`'s silent return vs `triggerReview`'s throw vs
    resolve's mixed behaviors become one convention.

---

## Part 3 — Constraints

- Follow `AGENTS.md` strictly: OOP classes, constructor-injected deps,
  `import "server-only"` in lib, no `any`/`!`-assertions, early guard clauses
  over `??`-buried missing data, named constants (no repeated domain strings),
  camelCase file naming for lib/constants, one class per file.
- Do not break: cloud + local agent modes, the template system (builder, YAML
  import/export, entry contracts), the fan-out/split runtimes, seed scripts, or
  the UI panel model. Where the fix changes a contract the UI reads, update the
  UI code accordingly for a green `npm run build`.
- Schema additions (`nodes.wait_until`, lease/journal/delivery columns) require
  coordinated `lib/db/rows.ts` mappers (see `AGENTS.md` §1) — that's expected
  and in-scope for this overhaul.
- No new npm dependencies without asking; prefer stdlib + what's present.
- Fix `docs/current-issue-plan.md` Issue 2 (the plan-node Retry dead-end) as a
  consequence of the overhaul (the plan node gets an executable replay path or
  the Retry action routes to chat-refire), not a special case.
- Update `AGENTS.md`/`README.md`/`docs/coding-patterns.md` where behavior or
  documented contracts change, and refresh seed fixtures (`scripts/seed-*.mjs`)
  and `docs/flow-templates/` YAMLs where they exercise the stale markdown
  `plan-meta` contract they no longer match.
- Where the overhaul would rewrite untouched neighbor code, keep the diff
  focused and flag the misalignments instead (per §0/§2.10 of `AGENTS.md`).

---

## Part 4 — Execution plan (do it in this order; each phase ships green `npm run check`)

- **Phase 0 — Pin the current behavior.** Write characterization tests (vitest,
  in-memory DB via `tests/helpers/inMemoryDb.ts`) covering the fragile seams:
  webhook/timer resume, finishSplit overwrite, recover() on each node kind,
  review-empty-output, build-progress-missing, decision label salvage, pipeline
  deadline timeout output — they document today's behavior and will flip when
  the fix lands (delete the assertion, keep a new corrected one). Also write the
  AST/lint no-raw-status-writes test and the illegal-transition-list assert
  runner on the existing engine.
- **Phase 1 — Transition authority + durable waits/leases.** Unified guarded
  transition layer with a declared table and attempt fencing; replace
  claim/setNodeStatus/raw writes everywhere; delete the `NodeSupport`/`NodeStore`
  duplicate; add the durable `wait_until` + run-lease columns; kill the
  `updated_at` heartbeat trick; reconcile all non-terminal states (Invariants 2,
  3), plus webhook-mark-before-dispatch and schedule-claim.
- **Phase 2 — Contract integrity.** `consumes` schemas + stage-start
  validation (fail-loud), unvalidated-publish escape removal, real Zod contracts
  for declarative nodes, edge-condition → output-key template lint, replace
  `jsonSchemaLite` (Invariant 5).
- **Phase 3 — One agent-output pipeline + recover ABI.** Shared component
  (parse/validate/envelope/retry-budget/events), migrate plan/build/review/
  decision/fix-agents onto it; formalized `recover()` result object + driver
  try/catch; remove per-node silent defaults and guesses; make `resolve`'s
  verify-before-publish required everywhere (Invariant 6, 4); fix pipeline
  timeout + durable gate progress; loop-edge `pushed` literal → declared join
  with a template lint backstop.
- **Phase 4 — Concurrency + half-apply.** Transactional completion batches,
  externally-idempotent MR-create/webhook-dispatch/schedule-fire with durable
  journal + late `markDeliverySeen` semantics; consistent duplicate-trigger
  events; remaining `nodeRunning`/`chainBusy` read-then-act checks folded into
  the claim (Invariant 7, 11).
- **Phase 5 — Agent self-repair surface.** Capability-gated read/repair tools
  for running agents; build-progress authoritative API path with the fence as a
  logged fallback; bounded `report_failure` (Invariant 10).
- **Phase 6 — Consistency pass.** Declare-and-delete the dead "advance
  interceptor" comment or implement the real table if kept; retire the legacy
  `steps` fan-out knob shim; fix README/seed/YAML plan-meta docs vs. the real
  turn envelope; close out plan-node dead-end; clean `docs/current-issue-plan.md`
  and `docs/review-tasks/` statuses your work resolves.

After each phase: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` green, plus at least one new test per invariant touched.

---

## Part 5 — Definition of done

- [ ] No code path writes `nodes.status` outside the transition authority
      (enforced by test).
- [ ] No silent-default fallback for missing/malformed agent output anywhere in
      the engine (grep-level checklist: "publishing it unvalidated", "(empty
      response)", `markDone` title salvage, review empty-pass, stdout
      scavenging, `planOutput?.model ?? …`, decision case-insensitive salvage
      are gone or gated behind loud, typed, event-emitting failures).
- [ ] A webhook/timer fires into a waiting node and the node actually runs
      (tested end-to-end, including the restarted-server case via the durable
      wait column).
- [ ] Two concurrent triggers of the same node produce exactly one run plus one
      skip event (tested).
- [ ] Reconciler driven on a node in every non-terminal state brings it to a
      defined outcome without guessing (tested per status).
- [ ] `recover()` can no longer throw out of the reconciler (tested).
- [ ] A restart during a pipeline wait resumes the gate (tested).
- [ ] Every node's `consumes` contract is validated at stage start; a missing
      field fails the node with a typed error naming the producer (tested).
- [ ] `docs/current-issue-plan.md` Issue 2 can no longer happen (tested: Retry
      on a chat-only node does not dead-end).
- [ ] Templates whose edge conditions reference nonexistent output keys are
      rejected by validate/lint (tested).
- [ ] `npm run check` + `npm run build` green; typecheck has zero new `any`;
      no suppressed `exhaustive-deps`.
