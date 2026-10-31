---
node_key: pipeline
kind: builtin
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Pipeline node

## Summary

The pipeline node is the CI gate between the build's merge request and code review: it watches the MR's head pipeline, triggers one via the git host API when none starts on its own (manual-CI projects), plays manual jobs, and waits for green. On failure it runs a bounded fix agent — failed job logs in, code push to the same branch out — and re-watches the new head pipeline, looping until green or budget exhausted. Only a green gate completes the node (`done`) and lets the chain advance to review.

Unlike the other agent nodes it has no approval step and no dedicated conversation mode: chat messages rerun the gate with the text as developer `guidance` for the next fix run.

## Capabilities contract

| Field | Value | UI / engine effect |
|-------|--------|-------------------|
| `refinable` | `true` | Chat rail is shown; a message reruns the gate with the text as `guidance`. |
| `chatMode` | — | Generic `NodeChat` rail. |
| `promptNode` | — | The prompt modal reads `GET /prompt?node=pipeline` directly (`previewPrompt`). |
| `panelTitle` | `CI pipeline` | Panel header title. |

Engine-only (not serialized to UI):

- `waitForKind: pipeline` — the engine resolves a template's gate node through this event-source marker (`flowEngine.gateKey`), not a literal key.
- `edges: [[review, "next"]]`, `order: 25` — graph position between build and review.
- No `builtinApproval`: the node never sits in `awaiting_approval`; its terminal states are `done` and `failed`.

## User-visible phases

### Phase 1 — Watching

- **Entry:** An MR exists — normally right after `approve_build` creates it (the chain starts the gate via the build → pipeline edge); also on manual `Check pipeline`, a poller-detected failed head pipeline, or a git host webhook.
- **Surface:** Panel running state (`Waiting for a green pipeline…`) plus `pipeline` events (`pipeline #N: <status>`) emitted on status change.
- **Action:** None required; the loop polls every `poll_interval_sec` (default 20 s).
- **Outcome:** Side-effect-free until the watched pipeline turns terminal. A missing head pipeline is auto-triggered once per episode (`auto_trigger_pipeline`); `manual` / `blocked` pipelines have their manual jobs played via the API (bounded at 20 plays per pipeline, `play_manual_jobs`).

### Phase 2 — Fixing

- **Entry:** Watched pipeline `failed`, fix budget remaining (`max_fix_attempts`, default 3).
- **Surface:** Event feed (`fix run N/M`), plus a `fix` artifact per run listed in the panel.
- **Action:** Automatic — the fix agent reads up to 3 failed job traces and pushes to the MR branch.
- **Outcome:** The gate enters a 2-minute grace window waiting for the push's own pipeline, then re-reads the head. A pipeline already fixed once is never re-fixed; a newer head supersedes the watched id.

### Phase 3 — Green

- **Entry:** Head pipeline `success`.
- **Surface:** Success alert (`Pipeline #N is green…`), footer `Re-check pipeline`.
- **Action:** Optional manual re-run.
- **Outcome:** Node `done` with `{pipelineId, status, fixes}` output; the chain advances to review.

### Phase 4 — Failed gate

- **Entry:** Fix budget exhausted, pipeline `canceled` / `skipped`, or the gate deadline passes (`gate_timeout_min`, default 80 min).
- **Surface:** Failed node status with the reason; footer `Check pipeline` retries.
- **Action:** `pipeline` action (optionally with an edited prompt) or generic `retry`.
- **Outcome:** A retry re-reads the current head — an already-green pipeline finishes immediately.

### Phase 5 — Chat guidance

- **Entry:** MR exists and the developer wants to steer the next fix.
- **Surface:** Chat rail.
- **Action:** Send a message → the gate reruns with `guidance` injected into the fix prompt.
- **Outcome:** Same lifecycle as Phase 1; without an MR the chat answers that the gate runs after build approval.

## UI architecture

### Workspace routing

`components/flows/panels/panelFactory.tsx`:

- Panel: `node.type === 'pipeline'` → `PipelineView`.
- Chat: `capabilities.refinable` → generic `NodeChat`.

### Panel (`PipelineView`)

- Header: `Edit prompt` opens `PromptModal` (`nodeKey="pipeline"`); `Run with this prompt` dispatches the `pipeline` action with `{prompt, promptIsBody, model}`.
- Body: green-pipeline success alert from `node.output`; `GenericArtifact` list of `fix` artifacts (empty state `No pipeline fix runs yet.`).
- Footer: gated on MR presence — without an MR it explains the gate runs after build approval; otherwise `Check pipeline` / `Re-check pipeline`.

### Chat rail

Generic `NodeChat`; sends go to `POST /api/flows/:id/chat` with `nodeKey`, landing in the overridden `PipelineNode.chat` (a gate rerun, not a lightweight follow-up).

### Async states

- Running: `PanelShell` `runningLabel` (`Waiting for a green pipeline — failures are fixed automatically…`).
- Prompt modal: `PromptModalSkeleton` while the prompt loads, explicit error + retry on failure.
- No MR yet: static hint instead of actions (explicit empty state).

### Key files

- `components/flows/panels/views/PipelineView.tsx`
- `components/chat/promptModal/PromptModal.tsx` (+ `hooks/useFlowChat.ts` prompt fetching)
- `components/flows/panels/NodeChat.tsx`, `components/flows/panels/panelFactory.tsx`

## Backend architecture

### Node class

`PipelineNode` (`lib/engine/nodes/kinds/pipeline/pipelineNode.ts`) extends `AgentRunNode<PipelineInput, PipelineOutput>`; key `pipeline`.

### Collaborators

- `GitHostResolver` (`gitHostRegistry`) — `getChangeRequest`, `getPipeline`, `createCRPipeline` / `createPipeline`, `listPipelineJobs`, `playJob`, `getJobTrace`.
- `mrTargetResolver` — resolves the watched MR (iid + branch), per-branch or flow-level.
- `prompts` (PromptLibrary) — the `pipeline_fix` template.
- `classifyHeadPipeline` / `shouldDeferPipelineTrigger` (`pipelineHead.ts`) — head-pipeline lookup kinds (`ok` / `none` / `stale` / `error`) and trigger backoff.
- `RunSupersededError` — a superseded fix run exits quietly.

### Run lifecycle (`run`)

1. Resolve the MR via `mrTargetResolver` (`input.branchName` for multi-branch flows); fold the `fix_prompt_body` knob into `input.prompt` (`promptIsBody`).
2. Poll loop until the deadline: re-read the MR **head** pipeline every cycle, switch the watched id when the head changes, and emit `pipeline` events only on `<id>:<status>` change. A stale-sha head is treated as no pipeline.
3. Terminal handling: `success` → `done`; `failed` → fix run (budgeted); `canceled` / `skipped` → `failed`; `manual` / `blocked` → play manual jobs (bounded); no pipeline → one API trigger per episode (merge-request pipeline first, branch pipeline fallback), deferred during post-fix grace or lookup errors.
4. Deadline → `failed` (retryable). Each cycle touches the node row so the reconciler reads the wait as alive; a mid-wait cancel/retry exits quietly.
5. `recover()` returns `false`: an interrupted wait never resumes — the user retry re-reads the head, which self-heals when already green.

### Chat lifecycle (`chat` / `converse`)

`chat` is overridden: it parses the previous input plus `guidance: content` and reruns the gate — without `flows.mr_iid` it answers that the gate runs after the MR exists. `converse` keeps the tier default (read-only follow-up on the last fix agent).

### Approval and advance

No approval: `done` flows straight through `advanceFrom(gate)` onto the pipeline → review edge (started by `SdlcChain` after MR creation, or by `triggerPipelineGate` for manual/poller/webhook triggers, which claims `pending`/`failed` and no-ops while the chain is busy).

### Key files

- `lib/engine/nodes/kinds/pipeline/pipelineNode.ts`, `pipelineHead.ts`, `schema.ts`
- `lib/engine/nodes/chains/sdlcChain.ts` (`triggerPipelineGate`)
- `lib/engine/runtime/flowPoller.ts` (`checkPipeline`), `lib/engine/runtime/commentIngestor.ts` (webhook-triggered gate runs)

## API surface

### HTTP

| Route | Caller | Purpose |
|-------|--------|---------|
| `POST /api/flows/:id/action` | `PipelineView` footer / prompt modal | `pipeline` action → `flowEngine.triggerPipelineGate`. |
| `POST /api/flows/:id/chat` | `NodeChat` | Guidance turns → `PipelineNode.chat`. |
| `GET /api/flows/:id/prompt?node=pipeline` | `PromptModal` (`useFlowPrompt`) | `previewPrompt`: fix body + rules assembly. |
| `POST /api/webhooks/gitlab` | Git host | Pipeline/comment events can re-trigger the gate (via `commentIngestor`). |

### Flow actions

| Action | When | Engine |
|--------|------|--------|
| `pipeline` (`pipelineId?`, `prompt?`, `promptIsBody?`, `model?`) | Manual (re-)check | `triggerPipelineGate` → `runNode` + `advanceFrom`. |
| `retry` | Failed gate | Standard node retry (re-runs `run`, re-reads the head). |
| `cancel` | Stuck wait | Stops the loop at the next poll cycle. |

### Actions not used

- `approve_build` / `approve_node` — the gate has no approval step.
- `run_node` from the client — gate reruns go through the `pipeline` action's claim-and-advance wrapper.

## Data model

### Input

`PipelineInput`: `branchName` (multi-branch MR selection), `pipelineId` (explicit pipeline to watch; default = MR head), `guidance` (chat-supplied fix steering), `prompt` + `promptIsBody` (fix prompt override / edited body), `model`.

### Output / artifacts

`PipelineOutput`: `{pipelineId, status, fixes, branchName?}`. Artifacts: kind `fix` per fix run, meta `{pipelineId, attempt}`, content = the agent's reply.

### Side effects

- `pipeline` events on status change; lifecycle events for triggers, manual-job plays, fix runs, supersession.
- Fix runs push commits to the MR branch; the agent run is recorded through the standard runner (cost/activity).
- Config knobs: `fix_prompt_body`, `fix_prompt_rules`, `max_fix_attempts` (3), `poll_interval_sec` (20), `play_manual_jobs` (true), `auto_trigger_pipeline` (true), `gate_timeout_min` (80), plus the split-consumption pair `split_consume` / `split_parallel_max`.

## Agent contracts

### Prompt keys

`pipeline_fix` (`FIX_PROMPT_KEY`) — the only template; resolved with `{branch, pipelineId}` variables and `{instructions, guidance, logs}` internal blocks.

### Response shapes

The fix agent's reply is stored verbatim as the `fix` artifact; there is no structured response contract — the gate's truth is the next head pipeline, not agent claims.

### Retries and guards

- Fix budget `max_fix_attempts` per gate run; a pipeline id already fixed is never re-fixed (supersession guard).
- Logs are capped (3 failed jobs, last 8000 chars of each trace); a failed fix-agent run is not retried inside the loop — the next poll cycle decides.
- Host-API lookup failures classify as `error`: the gate keeps waiting without triggering duplicates (`shouldDeferPipelineTrigger`).

## Future

- Multi-branch polling flips are a known issue tracked in `docs/review-tasks/21-multi-branch-correctness.md` (per-branch prev-status scoping).

## Out of scope

- MR creation and the commit-fix chain (build approval side) — see `build-node.md`.
- Webhook verification / ingestion internals and the flow poller loop.
- Review / resolve nodes downstream of the gate.

## Related code index

| Concern | Location |
|---------|----------|
| Gate loop (watch / trigger / play / fix) | `lib/engine/nodes/kinds/pipeline/pipelineNode.ts` |
| Head-pipeline classification | `lib/engine/nodes/kinds/pipeline/pipelineHead.ts` |
| Input/output schemas | `lib/engine/nodes/kinds/pipeline/schema.ts` |
| Chain trigger + advance | `lib/engine/nodes/chains/sdlcChain.ts` (`triggerPipelineGate`) |
| Poller / webhook gate triggers | `lib/engine/runtime/flowPoller.ts`, `lib/engine/runtime/commentIngestor.ts` |
| Git host port | `lib/engine/ports/gitHost.ts` |
| Panel / prompt modal / chat rail | `components/flows/panels/views/PipelineView.tsx`, `components/chat/promptModal/PromptModal.tsx`, `components/flows/panels/NodeChat.tsx` |
