---
node_key: node-infra
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Node infrastructure

## Summary

Every workflow node type — builtin or declarative — is a `NodeDefinition` subclass registered in the `NodeRegistry`, the single source of truth for the workflow graph. Node rows at flow creation, graph edges and layout, retry, chat routing, recovery, prompt templates, and UI labels all derive from the registry. Adding a node type means creating a folder under `lib/engine/nodes/kinds/` and adding one `register()` call (or, for declarative kinds, a `node_templates` row).

## Capabilities contract

The capabilities model splits engine-only behavior from what crosses the server→client boundary (`lib/engine/nodes/shared/capabilities.ts`):

| Field | Layer | UI / engine effect |
|-------|-------|-------------------|
| `refinable` | `NodeUiCapabilities` | Chat rail is shown; messages invoke the node's chat handler. |
| `chatMode` | `NodeUiCapabilities` | `'plan'` mounts `PlanNodeChat` instead of the generic `NodeChat`. |
| `promptNode` | `NodeUiCapabilities` | Prompt preview/edit targets this node's prompt template. |
| `panelTitle` | `NodeUiCapabilities` | Panel header title; falls back to the def's `label`. |
| `mergeBack` | engine-only | Marks the def a code child — `StepFlowManager` invokes it on child approval (today only `step_build`). |
| `fanoutOutput` / `splitOutput` | engine-only | Zod contracts for fan-out aggregates and per-unit split joins; `DEFAULT_FANOUT_OUTPUT` is the generic shape. |

`uiCapabilities()` projects a def's capabilities onto the serializable subset for the flow snapshot — RSC serialization rejects functions and class instances, so engine-only members never leave the server.

## Architecture

### `NodeDefinition` (`nodes/shared/nodeDefinition.ts`)

The abstract root class. Each def declares:

- **Identity and graph** — `key`, `label`, `order`, `edges` (`[target, "next" | "loop"]`), `isEntry` for the flow-opening kind.
- **Contracts** — `inputSchema` (strict run input), `outputSchema` (persisted `output` column), `configSchema` / `configFields` (typed knobs driving the auto-generated configurator form), `outputContract()` for the Contract tab, `choices()` for decision kinds.
- **Engine-dispatch metadata** — call sites key off these flags, never literal def keys: `builtinApproval` (approval is a builtin flow action, not generic `approve_node`), `chainRole` (`plan` | `build` | `review` | `resolve`), `resourceArtifacts`, `waitForKind`, `promptKeys` / `promptSections`.
- **Lifecycle** — `run(ctx, input, config)` → `RunOutcome`; `triggerInput` / `triggerRuns` for auto-start bundles (multi-run for the multi-branch build); `recover()` for restart recovery; `splitUnits` / `splitResolution` / `childTemplateId` for the split and fan-out ports (defaults: not a split source, no recommendation, auto-wrap self).
- **Persistence** — `applyOutcome` is THE one finish path (artifact, validated output, status, lifecycle event) shared by normal runs, no-run outcomes, and recovery, with optional `attempt_id` fencing via `RunSupersededError`.

Shared services are constructor-injected with singleton defaults (`NodeSupport`, `FlowContextHelper`) — tests pass their own instances.

### `AgentRunNode` (`nodes/shared/agentRunNode.ts`)

The middle tier for defs whose runs go through the agent runner — membership is behavioral ("does `run()` ever start an agent?"), which picks plan, build, pipeline, review and resolve in and keeps start / http / script out. It owns:

- `execute()` — the full run lifecycle: record input blob, `AgentRunner.executeRun`, finalize to a `RunOutcome`, apply through `applyOutcome` with supersede fencing.
- `chat()` — the default rerun-with-feedback recipe (`chatInput()` maps the message onto `{ feedback, model }`; defs with a different guidance field override `chatInput`, bespoke orchestration overrides `chat` whole).
- `converse()` — read-only follow-up on the existing agent (`followUpOn`); never changes node status, artifacts, or checklists, and declines when no agent exists yet.
- `turn()` — the chat entry the engine's `sendChat` dispatches to.

### `NodeRegistry` (`nodes/registry.ts`)

- `registerBuiltins()` registers the seven builtin defs: `start`, `plan`, `build`, `step_build`, `pipeline`, `review`, `resolve` (`constants/nodeKeys.ts`).
- `resolve(key, inst?)` falls back to the declarative resolver (wired once by `declarativeBootstrap`) for template-defined kinds — builtins by registry key, declarative kinds by their `node_templates` row id.
- Everything else derives from the registry: `order()` (node-row creation), `edges()` (workflow graph UI), `meta()` (labels), `entryKey()` (flow start).

### Supporting modules (`nodes/shared/`)

| Module | Role |
|--------|------|
| `nodeSupport.ts` | The node-kind-facing table service: node rows, artifacts, lifecycle events, agent ids, attempt-fenced patches. |
| `runContext.ts` | `FlowCtx` + `FlowContextHelper` — flow/task facts and diff building for run implementations. |
| `templateRenderer.ts` / `templateComposer.ts` | `{{...}}` interpolation and prompt assembly against the flow context map. |
| `extractJson.ts` | JSON extraction from agent prose (fenced blocks, trailing objects). |
| `payloadDigest.ts` | Stable digests for dedup/idempotency. |
| `split.ts` / `splitLookup.ts` | `SplitUnit` types and split-consume knob resolution. |
| `branchNamer.ts` | Branch name generation (`{prefix}/{slug}-{flowIdSuffix}` and `branch_pattern` tokens). |
| `mrTargetResolver.ts` | MR target branch resolution for chained builds. |
| `nodeRoles.ts` | Role interfaces chat/preview dispatch through; `CHAT_DECLINED` sentinel. |
| `declarativeNode.ts` / `declarativeRunConfig.ts` | Base class and run config for template-defined kinds — see `declarative-nodes.md`. |

### Constants (`lib/engine/constants/`)

`nodeKeys.ts` (builtin keys, `SDLC_TEMPLATE_ID`, `STEP_BUILD_TEMPLATE_ID`), `nodeStatus.ts` (the closed `NODE_STATUS` set and terminal-success test), `flowKind.ts`, `triggers.ts` (`wait_for` kinds), `vocabulary.ts`, `declarative.ts`.

## API surface

The registry is consumed by the engine (`flow-engine.md`) and by `GET /api/graph` (via `GraphService`). Node defs are not directly exposed over HTTP; the UI learns about them through the flow snapshot's projected `NodeUiCapabilities` and the graph payload.

## Data model

Node definitions are code (builtins) or `node_templates` rows (declarative kinds); node *instances* are `nodes` rows with `input` / `output` JSON blobs validated against the def's schemas, a config snapshot, and an `attempt_id` supersede fence.

## Out of scope

- Per-kind behavior — see `plan-node.md`, `build-node.md`, `pipeline-node.md`, `review-node.md`, `resolve-node.md`, `start-node.md`, `declarative-nodes.md`.
- The agent runner itself — see `agent-harness.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Definition contract | `lib/engine/nodes/shared/nodeDefinition.ts` |
| Agent-tier base | `lib/engine/nodes/shared/agentRunNode.ts` |
| Registry | `lib/engine/nodes/registry.ts` |
| Capabilities | `lib/engine/nodes/shared/capabilities.ts` |
| Persistence service | `lib/engine/nodes/shared/nodeSupport.ts` |
| Run context | `lib/engine/nodes/shared/runContext.ts` |
| Builtin keys | `lib/engine/constants/nodeKeys.ts` |
| Declarative bootstrap | `lib/engine/nodes/declarativeBootstrap.ts` |
