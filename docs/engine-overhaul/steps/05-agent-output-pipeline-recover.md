# Step 05 — One agent-output pipeline + recover ABI

## Goal

Invariants 6, 4, 9: **one agent-output pipeline** for every agent-emitting node, a
**fixed `recover()` ABI that never throws**, and **durable pipeline-gate progress**.
Every silent default found in the audit becomes a loud, typed, event-emitting
failure. Missing output is a first-class state, never a fabricated value. Also
closes the plan-node Retry dead-end (`docs/current-issue-plan.md` Issue 2) and
lands the prompt-injection fencing (decision Q3).

## Depends on

Step 02 (`publishOutcome` seam), step 04 (contracts the pipeline validates
against), step 03 (RecoveryDriver owner + pipeline gate lease/heartbeat).

## Files affected

- New: `lib/engine/nodes/shared/agentOutput/agentOutputPipeline.ts` — the single
  component: `extractJson` → contract validation → `output_error` envelope →
  per-node bounded retry budget → typed events (`output_retry`,
  `output_exhausted`, `agent_reported`, success).
- Edit: `nodeDefinition.ts` — `recover()` returns
  `Promise<RecoveryResult>` (`{kind:"recovered"} | {kind:"manual", reason}`),
  never throws; `retryBudget` knob per kind.
- Edit: `flowEngine.ts` `completeNodeFromResult` → RecoveryDriver wraps
  `def.recover` in the single try/catch (throw ⇒ `manual` + event); recovery
  outcomes publish via the authority.
- Migrate kinds onto the pipeline (audit evidence in parentheses):
  - `plan` — keep standard path; **remove**: empty-meta degradation
    (`planStore.ts:36-48`), positional step-id fabrication (`schema.ts:47-49`),
    silent `execution ⇒ whole` (`planStore.ts:89-93`) — all become typed failures
    or explicit, event-logged defaults chosen by the user.
  - `build` — build-progress fence parsed through the pipeline; missing/unparseable
    block with pending steps ⇒ `failed` + event (today silent `[]`);
    `markDone` case-insensitive title salvage deleted (id match only);
    corrupt plan-meta `catch{}` single-branch fallback ⇒ typed failure;
    chat-with-no-agent `(plan?.content ?? "")` ⇒ guard: refuse with typed error;
    `planOutput?.model ?? undefined` ⇒ validated via `consumes` (step 04).
  - `review` — empty reply ⇒ `failed` (today silent done-0); inline-post failure ⇒
    `failed` (retry resumes via the existing `postedHashes` ledger);
    `recover()` uses the ledger ⇒ returns `recovered` instead of always-false.
  - `decision` — envelope + bounded retry via the pipeline; case-insensitive label
    salvage deleted (typed mismatch failure); plain `Error`s become
    `AgentOutputError`s.
  - `agent` — markdown empty ⇒ `failed` (delete `"(empty response)"`,
    `agentNode.ts:559`); `recover()` re-parse wrapped by the ABI.
  - `resolve` — keep the good pattern; recovery with unparseable ledger meta ⇒
    `manual` + event, never empty-ledger effects re-apply
    (`resolveNode.ts:625-642`).
  - `script` — plain `Error`s become typed contract errors (scavenge already
    deleted in step 04).
- Pipeline gate (`pipelineNode.ts`): loop state (`fixes`, `manualPlays`, attempts,
  `lastSeen`) persists on the node row / artifact meta (Zod-validated); the wait
  loop is resumable — `recover()` re-enters the wait from durable state instead of
  always-false; deadline timeout builds a **fully-populated `PipelineOutput`**
  (`safeParse` before `applyOutcome`; no `output ?? {}`).
- Plan-node Retry dead-end: `flowEngine.retryNode` chat-first branch — recorded
  `turnUserMessage` ⇒ claim + replay via the chat refiner; no recorded turn ⇒
  revert to actionable status + lifecycle event (per current-issue-plan F2).
  `runNodeManual` keeps rejecting plan explicitly.
- Prompt fencing (Q3): new `lib/engine/prompts/untrustedData.ts` helper
  (`<untrusted-data source="…">` wrapper + never-instruct note); applied to
  resolve comments (`resolveContract.ts:250`, `promptTemplate.ts:54`), plan task
  PRD, build prompts.
- Tests: flip `recoverAbi`, `agentOutputFallbacks`, `pipelineGate`,
  `planRetryDeadEnd`; new `agentOutputPipeline.test.ts`,
  `recoveryDriver.test.ts`.

## Concrete tasks

1. Build the pipeline around the existing `AgentOutputError` standard (already used
   correctly by plan/resolve/agent-json) — generalize their three private
   implementations into the shared component; kinds supply contract + retry budget
   + event names only.
2. Change the `recover()` signature + the RecoveryDriver; migrate all 10 kinds
   (incl. start/http/script: `{kind:"manual", reason}` instead of bare `false`).
3. Delete the silent defaults listed above, one grep-verifiable removal each.
4. Pipeline-gate durable state + resumable wait; timeout output fully populated.
5. Plan-replay retry path + `FailureAlert` copy fix ("plan turn was interrupted").
6. `untrustedData()` fencing in the three prompt templates.
7. Prompt-layer hardening (Phase-1 prompt audit; architecture §5):
   - Replace the hand-authored JSON directives (plan ×3 in `promptDefaults.ts`,
     review's "JSON array ONLY", decision's prose `Return format`) with
     `AgentOutputError.directive(schema)` — one generated source of truth for
     first-turn **and** retry prompts (today they drift apart for plan).
   - Deduplicate the retry boilerplate ("re-emit your ENTIRE response…") from
     `planContract.ts` / `resolveContract.ts` / `agentNode.ts` into the pipeline.
   - `untrustedData()` + **loud caps** on every untrusted interpolation (task PRD,
     plan markdown, sibling packs, chat feedback, declarative `{{input.*}}`);
     silent `.slice()` truncations gain in-prompt notes + `log` events.
   - Retry coherence: build/review/resolve/pipeline retries rebuild from the
     current template + recorded vars (the plan pattern) instead of replaying
     frozen `input.prompt`; recorded prompts remain for audit/preview only.
   - Delete dead prompt code: `nodes.prompt_override` (Prisma migration), the
     `commit_fix` template, settings-overlay remnants.
   - Declarative agent/decision nodes get `previewPrompt` via the shared assembly;
     `diverges` reports *why* (template edit vs run data).
   - One source of truth for agent session identity (runs table), closing the
     `planNode.ts` main-agent-id TODO.
   - Model-override consistency (prompt audit #11): `decisionNode` stops
     hardcoding `model: null` and accepts the per-run override like every other
     node; `converse()` passes the resolved model. One resolution chain
     (`resolveAgentRunModel`) with no silent per-node exceptions.
8. Decomposition while migrating (quality bar):
   - `pipelineNode.ts` (~690 lines) splits into a thin `PipelineNode` def +
     `GateWaitLoop` (resumable wait, injectable poll/timeout), `GateFixRunner`
     (fix-agent runs), `GateProgressStore` (durable progress, Zod-validated) —
     under `lib/engine/nodes/kinds/pipeline/` per coding-patterns §3.11.
   - `buildNode`/`resolveNode`/`planNode`: extract collaborators as the output
     pipeline lands (parsing/retry logic moves into the shared pipeline; the def
     keeps orchestration only). Target: each def under ~400 lines.
   - Continue the `FlowEngine` carve-up: extract `FlowChatService` and
     `FlowRetryService` into `lib/engine/flow/` (retry semantics change in this
     step anyway — plan replay, recover driver wiring).

## Libraries used

None new.

## Risks

- **Behavior tightening breaks demo flows**: seeds exercise the markdown plan-meta
  convention the parser never consumed — refresh seeds in step 09, but verify here
  that the *seeded artifacts* still parse (they're data, not the live parse path).
- **Review `recover() ⇒ recovered`** can double-post if the ledger is incomplete —
  the ledger write must move into the same transaction as the comment post (step 06
  hardens this; note the ordering dependency in the PR).
- **Pipeline-gate resume** re-enters an 80-minute wait in tests: make the wait
  loop's poll/timeout injectable (constructor params) so tests use milliseconds.
- **Plan contract strictness** (no fabricated step ids) may reject older recorded
  plan inputs on retry: retries validate against the **current** schema — old
  recorded turns that relied on fabrication fail loud (acceptable: AGENTS §4.6
  current-flow-only).
- Fix-agent outputs have no contract today and get none — they stay prose +
  artifact; the pipeline governs *node* outputs only. Document this boundary.

## Acceptance criteria / tests

- Flip green: `recoverAbi.test.ts` (no kind throws), `agentOutputFallbacks.test.ts`
  (all six fallbacks), `pipelineGate.test.ts` (timeout schema-valid + **restart
  resume** loses its `test.skip`), `planRetryDeadEnd.test.ts`.
- Grep checklist (DoD): `"(empty response)"`, `markDone` title salvage, review
  empty-pass, stdout scavenging, `planOutput?.model ??`, decision case-insensitive
  salvage, `output ?? {}` — all gone.
- `agentOutputPipeline.test.ts`: success / retry / exhaust / agent-reported emit
  the typed events; budget is per-kind configurable.
- Recovery: bad recorded results (agent, decision, resolve-ledger) ⇒ `manual` +
  event, reconciler completes the pass.
- Prompt audit fixes: plan first-turn directive === retry directive (byte-equal,
  schema-generated); review/decision directives generated; a retry after a
  template edit uses the new template (tested); truncation emits in-prompt note +
  event (tested on resolve comments and review diff); `prompt_override` column
  and `commit_fix` template gone (grep); decision/agent previews return the
  composed prompt (tested).
- Quality: `pipelineNode` and `resolveNode` leave the `engineClassSize`
  allowlist; `buildNode` shrinks below 450 or stays listed with a note;
  `flowEngine.ts` shrinks by the chat/retry paths.
- `npm run check` + build green.
