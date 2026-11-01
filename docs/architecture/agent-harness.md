---
node_key: agent-harness
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Agent harness

## Summary

The agent harness is the neutral surface the engine drives coding agents through, regardless of where they run. A vendor-neutral `AgentPort` interface abstracts the two built-in runtimes — Cursor cloud (durable agent VMs) and Cursor local (in-process agent loop over the same SDK) — and the `AgentRunner` normalizes everything around them: model resolution, run-row persistence, event streaming, and usage/cost capture. Node definitions never talk to a vendor SDK directly.

## Architecture

### The port (`lib/engine/ports/agentPort.ts`)

`AgentPort` is the one interface per agent runtime: `start` (normalized `AgentStartSpec` → durable ids), `stream` (run to completion with `AgentStreamCallbacks`, re-attaching after restart when durable), `getRun` (probe for reconcile), `cancel`, `getUsage`, `inspectSession` (local restart recovery), `listCatalog` (model catalog), and `status` (settings-page health).

Normalized shapes mirror the SDK: statuses `"finished" | "error" | "cancelled"`, `AgentRunUsage` (token counts + billed cost), `AgentRunHandle` (durable `agentId` + `runId`). Ports also declare `fallbackModels`, `listDiscount` (billing-agreement fraction off the rate card), and `rateOverrides` (vendor corrections the public pricing source doesn't track).

`AgentPortRegistry` mirrors the git-host registry: adding a runtime = one adapter file + one `register()`. Selection is by the flow's execution mode (`forMode("cloud" | "local")`), preferring the port whose `harness` matches the `default_harness` setting — a stale setting falls back, never hard-fails a run. Built-ins self-register lazily: `CursorCloudAgentPort` (`lib/integrations/cursor/agentPort.ts`) and `CursorLocalAgentPort` (`lib/integrations/localAgent/agentPort.ts`).

### The runner (`lib/engine/harness/agentRunner.ts`)

`AgentRunner` sits between the node tier (`AgentRunNode`) and the ports:

- **`startAgent`** — resolves the model (per-run override → `default_model` setting → env default; local runs always pin a concrete id via `resolveAgentRunModel`, `lib/modelSpec.ts`), then shapes the spec per mode. Local: worktree-aware cwd (the flow's worktree when present, else the registered checkout hub) with `WorktreeManager.ensureForRun` and a dependency-setup advisory appended to the prompt. Cloud: `repos` from the flow's repo URL + starting ref.
- **`executeRun`** — the full lifecycle: persist the run row, stream to completion, capture usage, and throw on any non-`finished` terminal status. Late results are fenced by the node's `attempt_id` (`RunSupersededError` when the node was retried/cancelled mid-run); `ownsNodeStatus: false` opts chat-only turns out of the guard. The run row's final status is written in a `finally`, and leaked in-process handles are released.
- **Event normalization** — status/lifecycle events emit directly; assistant/thinking deltas go through `StreamBuffer` (1.5 s flush cadence, head/tail caps — 4k thinking, 20k assistant — so long streams don't flood the DB); tool calls emit paired start/end events, via `ToolPairer` in local mode (match by callId, FIFO per name otherwise, synthesized ids for unpaired ends).

### Usage and cost (`harness/usageTracker.ts`, `harness/pricingSource.ts`)

`UsageTracker.captureRunUsage` prefers the runtime's billed usage (`getUsage`); otherwise it estimates from token counts against the effective rate card: the LiteLLM-derived `PricingSource` table (chat models only, per-token → per-Mtok) merged with the port's `rateOverrides`, with the `pricing` setting winning (exact model id, then its wildcard, then longest-prefix). Token estimates are discounted by the port's `listDiscount`; billed charges are used as-is. Cost/token summaries land on the run row and the finish lifecycle event.

### Providers

- **Cursor cloud** (`lib/integrations/cursor/`) — wraps the cloud client (`client.ts`, credentials in `credentials.ts`): durable handles survive restarts, runs re-attach and bill usage; `autoCreatePR` and custom subagents supported.
- **Cursor local** (`lib/integrations/localAgent/`) — in-process agent loop (`agent.ts`) over the shared SDK runtime (`lib/integrations/cursorSdk.ts`). Runs are not durable; recovery probes the persisted agent session via `inspectSession`, and usage is account-gated (no billed cost). Fallback models when the catalog is unreachable: `composer-2.5`, `auto`.
- **Model specs** (`lib/modelSpec.ts`) — `"<model-id>[param=value,…]"` strings parsed into SDK `ModelSelection` (fast mode, effort/thinking level, …).

### Errors (`ports/agentErrors.ts`)

Typed lookup/timeout/workspace errors drive reconcile decisions — `AgentRunQuery` distinguishes `running` / `terminal` / `unavailable` so the reconciler re-attaches, recovers, or fails for manual retry.

## API surface

No direct HTTP surface — nodes consume the harness through `AgentRunNode.execute()` / `converse()`. Indirect surfaces:

| Route | Harness role |
|-------|--------------|
| `GET /api/models` | Model catalog via the selected port's `listCatalog` |
| `GET /api/settings` | Port `status()` health (configured / detail) |
| `GET /api/flows/:id/events` | The normalized event stream written by `executeRun` |

## Data model

- `runs` rows: `run_ref` (provider run id), agent/session id, status, token/cost rollup (see `utils/runTokenRollup.ts`).
- `events` rows: `status`, `lifecycle`, `tool`, `assistant`/`thinking` (buffered), `error` kinds (`constants/vocabulary.ts`).
- Settings: `default_harness`, `default_model`, `pricing` (rate-card overrides).

## Out of scope

- Node-tier run orchestration (`AgentRunNode`, `applyOutcome`) — see `node-infra.md`.
- Worktree creation/lifecycle — see `git.md`.
- MCP server configuration UI — see `templates.md` (node config) and `domain-services.md` (settings).

## Related code index

| Concern | Location |
|---------|----------|
| Port interface + registry | `lib/engine/ports/agentPort.ts` |
| Port errors | `lib/engine/ports/agentErrors.ts` |
| Run supervision | `lib/engine/harness/agentRunner.ts` |
| Stream buffering | `lib/engine/harness/streamBuffer.ts` |
| Tool-call pairing | `lib/engine/harness/toolPairer.ts` |
| Usage/cost | `lib/engine/harness/usageTracker.ts`, `pricingSource.ts` |
| Cloud provider | `lib/integrations/cursor/agentPort.ts`, `client.ts` |
| Local provider | `lib/integrations/localAgent/agentPort.ts`, `agent.ts` |
| Shared SDK runtime | `lib/integrations/cursorSdk.ts` |
| Model specs | `lib/modelSpec.ts` |
