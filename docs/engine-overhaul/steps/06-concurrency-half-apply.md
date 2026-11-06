# Step 06 — Concurrency + half-apply

## Goal

Invariants 7 and 11: **complete state writes** and **consistent trigger
semantics.** Every multi-row write is one Prisma transaction; every sequence
around external I/O is journaled through the `jobs` table. All trigger entry
points funnel through one `TriggerGateway` — duplicates lose the atomic claim and
always emit a typed `skipped_duplicate_trigger` event. Read-then-act coordination
(`nodeRunning`, `chainBusy`) folds into claim from-sets.

## Depends on

Step 02 (claims/transitions centralized), step 03 (job queue exists), step 05
(recovery/ABI so journaled sequences have a finisher). Step 04 for outcome
validation inside completion transactions.

## Files affected

- New: `lib/engine/runtime/triggerGateway.ts` — single entry:
  `trigger(flowId, nodeKey, source, input?) → {started} | {skipped, reason}`;
  sources: `ui | webhook | poller | schedule | effect`. Constructor-injected from
  the container (Q9), never a module singleton.
- Edit: `flowEngine.ts` — `runNodeManual`, `retryNode`, `sendChat`, approve paths,
  `triggerPipelineGate`/`triggerReview`/`triggerResolve` (via `sdlcChain`) all call
  the gateway; result object maps to HTTP at the route (200 started / 409 skipped
  with the event recorded).
- Edit: `sdlcChain.ts` — `chainBusy`/`nodeRunning` read-then-act replaced by claim
  from-sets (chain-busy = single conditional `UPDATE` against the chain nodes'
  in-flight set); silent return vs throw split deleted.
- Edit: `nodeSupport.ts` — `saveArtifact` supersede+insert in one
  `prisma.$transaction`; `registerStartupRun`/`persistRun` placeholder dance in one
  transaction.
- Edit: `flowEngine.ts` `cancelNode` — cancel-intent journal row **before** remote
  cancel; reconciler completes interrupted cancels (runs → error, node → failed).
- Edit: `mergeRequestService.ts` — MR create journaled (job kind `mr_create` with
  flow dedup key); crash window covered by reconciler re-claim (adopt path already
  exists); flows row update in the same transaction as job completion.
- Edit: stage completion (`edgeActivator.ts` / `publishOutcome`) — terminal write +
  artifact save + event emission + `plan_steps` check-off in one transaction.
- Edit: `app/api/hooks/[id]/route.ts`, `app/api/webhooks/gitlab/route.ts` — job
  attempts/backoff from step 03 wired to typed failure events.
- Tests: flip `duplicateTrigger.test.ts`; new `triggerGateway.test.ts`,
  `completionTransaction.test.ts`, `cancelJournal.test.ts`.

## Concrete tasks

1. `TriggerGateway`: resolve def → claim via authority (from-set per trigger kind)
   → on `ConflictError`/busy, emit `skipped_duplicate_trigger` (debug) with the
   source and the holder's attempt id, return `{skipped}`. No path returns
   silently and no path throws for a duplicate.
2. Route mapping: action route returns `{ok:true}` on started, `409 {code:
   "skipped_duplicate_trigger"}` on skip; the UI mutation surfaces the skip
   (toast/inline), not a generic error.
3. Completion batch transaction: outcome publish + artifact + event + checklist
   updates atomic. Verify no `await` of agent/git I/O inside (I/O already done in
   the stage; this is pure DB).
4. Cancel journal: `cancel_intents` (or `jobs` kind `cancel`) — write intent, do
   remote cancel, finalize via authority; reconciler finalizes orphans.
5. MR-create journal + adoption on re-claim; the `approved`-no-MR reconciler branch
   (step 03) re-claims this same job kind.
6. Kill the remaining read-then-act: `chainBusy`, `nodeRunning`,
   `triggerResolve`'s double guard, `runNodeManual`'s status pre-read — all become
   claim from-sets. (The reads may survive for UI display, never for coordination.)
7. Webhook poison handling: attempts ≥ MAX ⇒ job `failed` + typed event + HTTP 200
   (stop sender retries) with the failure visible in the flow.

## Libraries used

None new.

## Risks

- **Transaction scope creep**: keep transactions pure-DB; the stage does I/O first,
   publishes after. The one temptation (check-off plan steps inside publish) is
   included deliberately — it shares the terminal write's atomicity requirement.
- **Duplicate-event noise**: webhook + poller race on every pipeline failure; the
   skip event is debug-level and dedup-friendly in the UI (group identical skips).
- **Claim from-set regressions**: chain-busy-as-claim must exactly match the old
   predicate set (`templateStore.chainNodeKeys` + in-flight statuses) — pin with a
   characterization test before replacing.
- **Cancel journal** adds a second writer to runs rows: only the reconciler
   finalizes orphaned intents; document the ownership.
- HTTP 200-on-poison hides failures from GitLab's retry UI by design — the failure
   must be loud in **our** event feed instead (that's the trade; document it).

## Acceptance criteria / tests

- Flip green: `duplicateTrigger.test.ts` — two concurrent triggers of the same node
  ⇒ exactly one run + one `skipped_duplicate_trigger` event.
- New: `triggerGateway.test.ts` (every source; skip emits event; result-object
  convention uniform); `completionTransaction.test.ts` (kill-point tests: crash
  between outcome/artifact/event leaves no partial state — use a transaction
  fault-injection hook); `cancelJournal.test.ts` (orphaned intent finalized).
- Grep: `chainBusy(`/`nodeRunning(` no longer guard writes (UI reads excepted);
  `triggerPipelineGate` silent return and `triggerReview` throw both gone.
- `npm run check` + build green.
