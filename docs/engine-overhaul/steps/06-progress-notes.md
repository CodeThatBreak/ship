# Step 06 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; the
`duplicateTrigger` step-00 marker flipped; grep checklist clean).

## What landed

- **TriggerGateway (Invariant 11)**: `lib/engine/runtime/triggers/` —
  `TriggerGateway` with two doors over the transition authority:
  `claimTrigger` (run starts: `runFromPending` / `retry` / `chatRefine` /
  `manualStage` / `manualResolve` / `resumeWait`) and `transitionTrigger`
  (approval-style entries: `approve` / `buildApprove` / `planRetryRevert`).
  Every loser of the atomic claim emits ONE typed
  `skipped_duplicate_trigger` event (debug-tier; data carries `source`,
  `trigger` key, node `status`, the holder's `attemptId`) and returns the
  result object `{started:false, skipped:true, reason}` — the old silent
  returns vs `ConflictError` throws split is gone. Constructed in
  `createEngineParts` (Q9) — no module singleton.
- **Chain-busy as a claim from-set (task 6)**:
  `TransitionAuthority.claimTrigger` folds the chain in-flight guard into
  the SAME conditional `UPDATE` (`NOT EXISTS (… sibling chain nodes in
  'running')`, target excluded) — no read-then-act window remains for a
  second chain stage. `flowEngine.nodeRunning` is deleted;
  `flowEngine.chainBusy` survives ONLY as the WaitStore's comments-debounce
  re-defer read (see deviations). The old predicate set is pinned by
  `triggerGateway.test.ts` (running sibling blocks; a terminal sibling never
  did).
- **Every trigger funnels through the gateway**: `sdlcChain`
  `triggerPipelineGate`/`triggerResolve`/`triggerReview`/`approveBuild`;
  `flowEngine.runNodeManual` (the status pre-read now only SELECTS the claim
  key — the from-set decides); `FlowRetryService.retryNode` (+ plan retry's
  two branches); `FlowChatService.sendChat`; `FlowApprovalService`
  approvePlan/approveNode; `EdgeActivator.startNodeStage` (the auto/resume
  start — the old swallowed claim conflict now emits the skip event), with
  source threading: poller ticks → `poller`, webhook ingest → `webhook`,
  wait sweeps → `poller`, webhook resume → `webhook`, everything else →
  `ui`/`effect`.
- **Route mapping (task 2)**: the action + chat routes map the result
  object — `{ok:true}` on started, `409 {code:"skipped_duplicate_trigger"}`
  on skip. The UI (`hooks/fetchJson.ts` typed `HttpError` +
  `constants/api.ts` `API_ERROR_CODE`) surfaces the skip as a neutral
  "Already running — a duplicate trigger was skipped" notice in the panel
  action banner and the chat rail; the feed renders the new event kind
  muted (debug tier, `CircleMinus`, below log) in both feed paths.
- **Completion batch transaction (task 3, Invariant 7)**: `applyOutcome`
  (and `failOutputContract`) run artifact save + terminal
  `publishOutcome` + lifecycle event in ONE pure-DB transaction —
  `publishOutcome`/`publishAggregate`/`announcedTransition`/`emit` gained
  `tx` seams (`utils/executor.ts` bridges the Database-shaped API over a
  Prisma tx client). `saveArtifact` (supersede + version read + insert),
  `registerStartupRun`, `persistRun`'s fallback are each atomic. The
  fan-out rollup batches its check-offs + branch upserts + `mr_branch` +
  diff artifacts in one transaction; `planSteps.setStatus` gained the `tx`
  seam so the check-offs are store calls, not raw in-tx SQL.
  `supersededOrConflict` moved to `utils/` (kept `nodeTransitions` under
  its 450 ceiling).
- **Cancel journal (task 4)**: `cancelNode` writes the intent first —
  `jobs` kind `cancel` (dedup `cancel:<flowId>:<nodeKey>`), claim, inline
  `CancelHandler` dispatch (run kills → runs errored → declared `cancel`
  transition → step-child notifications; idempotent no-op on an already
  terminal node), complete. A lost claim returns without a second
  finalize. The worker sweep's `reclaimExpired` finalizes orphaned intents
  (crash between claim and finalize ⇒ runs → error, node → failed).
- **MR-create journal (task 5)**: `jobs` kind `mr_create` (dedup
  `mr_create:<flowId>:<branch ?? '_'>`); `approveBuild`'s background task
  enqueues write-ahead, claims, and dispatches `MrCreateHandler` inline
  (commit-fix loop wired through the now-public `runBuildCommitFix` via
  `flowEngine.sdlcCommitFix`). `MergeRequestService.create` splits its
  contiguous DB tail from host I/O and lands branch/flow MR rows + the
  job's completion in ONE transaction (`onPersist`). `CommitError` (fix
  budget exhausted) is a NORMAL terminal handled in the handler (mr-failed
  event + `mrHandback` + job done); infra errors rethrow → queue backoff
  requeue → terminal-fail with the typed event. `ApprovedHandler` no
  longer reverts an approved build while a live `mr_create` job exists —
  the journal owns the MR creation; only a job-less approved build
  reverts.
- **Webhook poison handling (task 7)**: both ingest routes answer HTTP 200
  `{ok:true, delivery:"requeued"|"failed"}` after `jobs.fail` — the sender
  stops retrying (the trade, documented at the catch: the failure is loud
  in OUR event feed instead of GitLab's retry UI); the queue's terminal
  `error` event names kind, job id and the error.
- **Tests**: flipped `duplicateTrigger.test.ts` (poller + webhook + manual
  of a running gate ⇒ one run + skip events). New:
  `triggerGateway.test.ts` (every source; won-claim result shape; the
  chain-guard characterization; approval-door convention),
  `completionTransaction.test.ts` (fault-injection via a `db.transaction`
  stub + proxy tx client that throws on the matched raw/model statement —
  crash between artifact/terminal/event leaves no partial state; the
  fan-out rollup batch rolls back whole and re-runs idempotently),
  `cancelJournal.test.ts` (orphaned intent finalized by the sweep; inline
  cancel end-to-end; the MR adopt path lands MR + flow row + job done),
  `webhookPoison.test.ts` (budget exhaustion ⇒ failed job + one typed
  event naming kind + error).

## Design calls worth knowing

- **The gateway owns the claim, not the dispatch.** The doc's
  `trigger(flowId, nodeKey, source, input?)` is realized as two doors whose
  post-claim work stays with the caller (chain stage bodies, the manual
  run's join/step-child handling, the chat turn). That kept every dispatch
  body byte-identical — the only semantic changes are the fence + event.
- **The chain guard lives in the authority, not the gateway**: it is a
  status write (a claim), so it belongs behind Invariant 1's door; the
  gateway is the policy layer (event + result object).
- **`transitionTrigger` for approvals**: an approve of a node that is not
  `awaiting_approval` now emits the typed skip event + 409 code (the
  message detail — actual status — rides the event data). One convention,
  per the step's "no silent return vs throw split".
- **`chooseNode` stays on the plain `ConflictError` path**: its write is
  inside the decision def's `applyChoice` (def-owned), so there is no
  engine-level door to funnel; flagged rather than forced.
- **Approve-first ordering in `approvePlan`**: the plan artifact is read
  (and refused loudly) BEFORE the transition so a stale click can never
  flip artifact states; the transition then lands before the meta-override
  writes, so bookkeeping only runs for a won approve.
- **Retry lifecycle moved after the claim**: `retrying X` now emits only on
  a won claim (a skip no longer trails a false "retrying" line).

## Deviations / flags for review

- **`mr_create` dedup key is per-branch** (`mr_create:<flowId>:<branch>`),
  not the doc's "flow dedup key": a flow-level key would collapse
  multi-branch creates (one job per branch target is required).
- **Dedup keys are freed on completion/terminal failure** (new
  `JobQueue.clearDedupKey`): static keys would permanently wedge
  cancel-after-retry and re-approve-after-failure. Side effect: a
  re-delivered webhook can re-enqueue after its job terminal-failed (the
  re-claim path still dedups in-flight).
- **Infra failures of `mr_create` auto-retry** (queue backoff, ≤ 5
  attempts) instead of the old immediate handback; `CommitError` keeps the
  handback UX. `ApprovedHandler`'s live-job guard closes the loop.
- **Schema change (AGENTS §1 normally asks first)**: the `job_kind` Prisma
  enum gained `cancel` + `mr_create` — required by the step's own design
  ("jobs kind cancel", "job kind mr_create"); landed as migration
  `20261120183000_step06_cancel_mr_create_job_kinds` with client regen.
  Sticky enum values — flagged for sign-off.
- **The WaitStore's `chainBusy` read survives** (comments-debounce
  re-defer): it extends a `wait_until`, it never guards a node status
  write — firing into a busy chain would skip-claim and leave a past
  `wait_until` for a tight sweep loop. The grep AC ("no longer guard
  writes") holds; flagged as the deliberate exception.
- **`schedule` source is wired in the vocabulary + gateway but the
  schedule fire's stage claims currently land as `effect`**: threading a
  source through `startFromTemplate` → factory → `start` was out of step
  proportion; the gateway test covers the source directly. Flagged as a
  small granularity gap.
- **Rollup aggregate publish stays outside the rollup tx** (task 3's one
  deviation): `finishFanout` continues into `advanceFrom`, which can run
  downstream stages (agent I/O) — the step's risk note forbids I/O inside
  a transaction. The publish is one attempt-fenced statement; a crash
  between batch and publish re-runs idempotently (test-covered).
- **`planSteps.syncFromPlan`/`replaceBranch` remain multi-statement** (the
  plan checklist sync is not atomic); the plan node's terminal batch itself
  is covered by `applyOutcome`'s transaction. A wider `planStepStore` tx
  pass is follow-up material.
- **No route-handler-level tests exist in this repo** (no precedent for
  importing `app/api/**/route.ts` into tests); the 200-on-poison mapping
  is two lines verified by reading + typecheck; the queue/event semantics
  are tested.
- **Size pins**: `flowEngine.ts` 1114 → 1090 (plan-step editing carved to
  `FlowPlanStepService`, the step-05 `flow/` pattern — the pin updated to
  the new lower count); `stepFlowManager` exactly at its 1347 pin;
  `nodeTransitions` 448 (supersededOrConflict extracted). No allowlist
  grew.
- **`npm test` tally**: 182 files, 813 passed + 1 expected fail
  (`noProcessSingletonOutsideDb` — the frozen marker owned by later
  steps).
