# Task 29: Webhook delivery reliability

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 09: Typed domain errors and one route error mapper](09-typed-errors.md)
- **Findings:** CR-043, CR-044
- **Effort:** S

## Goal

The generic webhook marks a delivery seen before dispatch, so failed deliveries are lost on retry. The GitLab webhook has no error handling around engine calls, so GitLab retries and eventually disables the hook.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-043 [Medium] The generic webhook records a delivery as seen before dispatching it, so failed deliveries are lost on retry

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/hooks/[id]/route.ts:43-46,53-79, lib/engine/runtime/hook-store.ts:150-171
- **What to do:** `deliverySeen` still inserts the `webhook-id` before the JSONata filter and dispatch, so a delivery whose filter evaluation or `startFromTemplate`/`resumeNodeFromWebhook` fails is answered `{dedup:true}` on retry and never processed. Split into `isSeen`/`markSeen` and mark only after successful dispatch or a deliberate filter drop.

### CR-044 [Medium] The GitLab webhook parses the body before auth and has no error handling around engine calls

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/webhooks/gitlab/route.ts:8-10,27-30,37-74, lib/engine/nodes/chains/sdlc-chain.ts:142-145
- **What to do:** The route still does `await req.json()` before `verifyWebhook`, has no try/catch around `ingestComments`/`emitEvent`/`triggerPipelineGate` (which throws "no pipeline gate node" for gate-less templates → 500 → GitLab retries/disables the hook), and keeps the duplicate `flowScheduleFallback`. Verify first, parse with `.catch(() => null)` → 400, move handling into a `flowEngine.handleHostEvent(event)` and log domain errors while returning 200.
- **Fix after:** CR-046 ([Task 09](09-typed-errors.md))

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
