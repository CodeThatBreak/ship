# Step 05 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; all step-00
markers for this step flipped; grep checklist clean).

## What landed

- **The fixed `recover()` ABI (Invariant 4)**: `NodeDefinition.recover()`
  returns `Promise<RecoveryResult>` — `{kind:"recovered"} |
  {kind:"manual", reason}` (type in `nodes/shared/types/recovery.ts`) — and
  never throws. The single try/catch lives at the recovery seam
  (`FlowEngine.completeNodeFromResult`): a throw maps ONCE to `manual` + an
  error event, so the reconciler pass is crash-safe per node. All ten kinds
  migrated; start returns `recovered` (the stage completes synchronously);
  script/http return `manual` with the reason a retry re-runs them.
- **The one agent-output pipeline (Invariant 6)**:
  `lib/engine/nodes/shared/agentOutput/` — `AgentOutputPipeline` (the
  validate→envelope→bounded-feedback-retry loop with the typed events
  `output_retry` / `output_exhausted` / `agent_reported` in `EVENT_KIND` +
  the client mirror), `utils/standardOutput.ts` (the shared extractJson →
  object-gate → envelope → schema → semantics validation; the three private
  plan/resolve/agent copies are gone), `utils/retryFeedback.ts` (the one
  "re-emit your ENTIRE response" body), `constants/agentOutput.ts` (the one
  `RETRYABLE_OUTPUT_ERRORS` — the four duplicated sets are gone).
  `NodeDefinition.retryBudget` is the per-kind knob (default 1; review/build
  are validation-only at 0). plan/resolve/agent/decision run their contract
  misses through the pipeline; review/build validate through the shared
  standard validator and map misses to failed outcomes themselves.
- **Silent defaults deleted** (each grep-verifiable): review empty reply ⇒
  `failed` and the inline-post failure ⇒ `failed` (retry resumes via the
  `postedHashes` ledger — the finalize/posting path is now one shared
  `reviewOutcome` used by run and recover); agent's `"(empty response)"`
  fabrication (empty markdown is a typed failure); decision's
  case-insensitive label salvage (exact match or typed `schema_mismatch`,
  which the pipeline's feedback retry can fix); build's silent empty
  progress report (missing/unparseable fence with pending steps ⇒ failed +
  `output_contract_violation` event), `markDone` title salvage (meta-id only),
  the corrupt plan-meta single-branch fallback (typed failure), the
  `(plan?.content ?? "")` chat-refine fallback (loud refusal);
  `planOutput?.model` read validates against the plan node's published
  `PlanOutput` contract.
- **Pipeline gate (Invariant 9)**: `pipelineNode.ts` (689) split into the
  thin `PipelineNode` (270) + `GateWaitLoop` (the resumable poll loop) +
  `GateFixRunner` (fix-agent runs) + `GateProgressStore` — durable progress
  (`fixes`, `manualPlays`, `lastSeen`, `fixedIds`, `triggerAttempted`,
  `fixWaitStart`, `deadlineAt`) persists as Zod-validated `gate_progress`
  artifact meta on every state change. `recover()` re-enters the wait from
  the snapshot (the ORIGINAL deadline rides it, so a crash-loop cannot reset
  the window); no/unparseable progress is `manual`. The deadline-timeout
  terminal is fully populated (`pipelineId: null` + `status: "unknown"` +
  `timedOut` — `PipelineOutput` widened; the old `output ?? {}` is gone).
  Poll/timeout are injectable (constructor `timing`).
- **Plan-node Retry dead-end** (`docs/current-issue-plan.md` Issue 2):
  already closed ahead of the step (`planRetryDeadEnd.test.ts` was green);
  this step kept the semantics intact through the retry-service extraction
  and fixed the `FailureAlert` copy (description now says the turn failed
  before the plan could be applied and points at retry + the feed).
- **Prompt fencing (Q3) + loud caps**: `lib/engine/prompts/untrustedData.ts`
  (`<untrusted-data source>` wrapper + never-instruct note; cap ⇒ in-prompt
  truncation note + a machine-readable signal), `prompts/caps.ts`. Applied
  at: resolve comment bodies/block (the `truncations[]` signal becomes one
  `log` event), review diff + PRD (run + preview byte-parity), task-context
  PRD, build's approved plan, agent `{{input.*}}` values, decision flow
  state, pipeline fix logs (the 3×8k budget kept, now loud; the assembly
  extracted as `pipeline/utils/fixLogs.ts`).
- **Prompt-layer hardening**: plan ×3 / review / decision hand-authored JSON
  directives replaced by `AgentOutputError.directive(schema[, shape])` —
  first-turn === retry byte-equal (the plan contract blocks advertise the
  unified `PlanTurnOutput` envelope everywhere); review's array contract
  rides a new optional `shape` parameter (the object bytes are frozen and
  pinned by test). Dead prompt code deleted: `nodes.prompt_override` column
  (schema + `NodeRow` + every SELECT; hand-authored drop migration
  `20261120163600_step05_drop_prompt_override`, the step-03
  `prisma migrate diff` precedent), the `commit_fix` template, the
  settings-overlay tombstone. Declarative agent/decision nodes gained
  `previewPrompt` (preview === run bytes); `diverges` reports WHY
  (`template-edited` vs `run-data`). Retry coherence: `retryNode` strips the
  recorded `prompt`/`promptIsBody`/`prompt_source` for
  build/step_build/review/resolve/pipeline so the retry rebuilds from the
  CURRENT template + recorded vars (recorded prompts stay for
  audit/preview). Plan's main-agent-id TODO closed — the runs table
  (`lastAgentId`) is the one session-identity source. Decision stops
  hardcoding `model: null` and accepts the per-run override on both the main
  run and the pipeline retry turn.
- **Decomposition**: `resolveNode.ts` 724 → 289 (new `ResolveFinisher` owns
  the finalize/recovery pipeline; consts/types/utils to named homes) — it
  LEAVES the frozen-giants list; `pipelineNode` leaves it too;
  `decisionNode` (466 → 416) and `buildNode` (→ 557) shed pure helpers into
  `utils/`; `flowEngine.ts` 1246 → 1114 with `FlowChatService` +
  `FlowRetryService` in `lib/engine/flow/` (the step-02 approval-service
  pattern, co-located tests included).
- **Tests**: flipped `recoverAbi` (the agent/decision pins now assert the
  manual result; the review pin asserts the ABI result shape),
  `agentOutputFallbacks` (all three), `pipelineGate` (timeout schema-valid +
  TWO restart-resume tests: budget honored, green resume). New:
  `agentOutputPipeline.test.ts` (7), `recoveryDriver.test.ts` (6 — including
  the throw⇒manual seam through the real engine), `flowChatService.test.ts`,
  `flowRetryService.test.ts`, `untrustedData.test.ts`, `fixLogs.test.ts`,
  `generatedDirectives.test.ts`, `declarativePreviewPrompt.test.ts`,
  `promptRetryRebuild.test.ts`.

## Design calls worth knowing

- **The recovery seam's catch lives in `completeNodeFromResult`**, not
  literally inside RecoveryDriver: `def.recover` is invoked there, and that
  is the one place every recovery path (reconciler walk + cloud re-attach +
  restart probes) flows through. RecoveryDriver's own outer catch remains as
  the belt-and-braces for probe/attach failures; its doc now points at the
  seam.
- **Gate resume runs the wait loop to its terminal INSIDE `recover()`**
  (awaited, per the step doc's risk note). Consequence, flagged for step 06:
  a reconciler pass that resumes a gate takes as long as the remaining wait;
  the loop's own `heartbeatLeases` keeps the reconciler from re-recovering a
  live gate, so correctness holds — cadence is the open question.
- **Review recovery re-runs the posting path** (ledger-deduped) instead of
  inspecting the ledger passively: a crashed run resumes exactly where it
  stopped. The known double-post window (host post succeeded, ledger write
  did not) is unchanged — the ledger write must move into the host-call
  transaction in step 06 (ordering dependency noted in the step doc).
- **`AgentOutputError.directive(schema, shape)`** gained the optional
  `"array"` shape for review; the object-contract bytes are untouched
  (pinned by test), so agent/plan/resolve prompts did not change beyond the
  intended directive swaps.
- **Decision retry semantics changed by design**: a decision agent pick now
  gets ONE bounded feedback turn on a contract miss (previously: instant
  fail). The retry rides the same agent session (`followUpOn`) and the same
  generated directive.
- **Build's progress gate** keys on PENDING steps: a missing/unparseable
  report with zero pending steps (plan fully done, or no checklist) stays a
  normal finish — the failure is only for lost progress that mattered.
  `step_build` is untouched by the gate by design: a step child never
  self-reports progress (its steps go green on merge, not on agent report).

## Deviations / flags for review

- **`taskContext` PRD cap emits no event**: the cap is loud in-prompt, but
  `FlowContextHelper` has no event handle; plumbing one is a wider seam —
  flagged, not forced.
- **`script` typed-error scope**: step 04 already routed the script output
  channel through `OutputContractError` + the typed event; the remaining
  plain `Error`s (timeout, non-zero exit) are EXECUTION failures, not output
  contract misses — left as execution errors (the engine maps them to the
  failed terminal with the message). Read as: script's output path already
  satisfies the invariant.
- **`edgeActivator.ts:48` `output ?? {}`** remains: it is the
  inherited-input materialization where an upstream with no output yet
  legitimately contributes an empty merge (AGENTS §2.9's genuine-empty case),
  not a fabricated node output — flagged rather than changed.
- **Fixture updates are behavior-honest**: the fake build agents in
  `sdlcHappyPath`/`planChatToGate` now emit the `build-progress` fence the
  real prompt instructs (the silent-`[]` tolerance is gone); the step-00
  decision recover fixture needed outgoing edges (the old `test.fails` body
  never actually reached the assert).
- **Pre-existing red the subagents repaired**: the prompt-hardening commit
  grew `flowEngine.ts` past its frozen pin and `decisionNode` over 450 —
  repaired per the shrink-only policy (pin updated to the new lower count,
  helpers extracted); no allowlist grew.
- **`npm test` tally**: 178 files, 794 passed + 2 expected fail (the
  frozen-inventory `test.fails` suites `noProcessSingletonOutsideDb` and
  `duplicateTrigger` — pre-existing step-00 markers owned by later steps).
