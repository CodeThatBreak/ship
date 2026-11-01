---
node_key: flow-engine
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Flow engine

## Summary

The flow engine is the orchestrator behind every flow: it creates flows from templates, sequences node runs along the template graph, routes chat and approval actions to node definitions, and recovers state after restarts. All node-type-specific behavior lives in the node classes behind the `NodeRegistry`; the engine only sequences them and owns cross-node state transitions. Chain positions (`pipeline`, `review`, `resolve`) are derived from the flow's template graph at run time — no node-key constants drive orchestration.

## Architecture

### Orchestrator (`FlowEngine`)

`lib/engine/flowEngine.ts` — the single entry point for flow operations. It composes five collaborators instead of carrying the logic itself:

| Collaborator | Role |
|--------------|------|
| `FlowFactory` (`runtime/flowFactory.ts`) | Flow creation: task + repo binding, template graph snapshot onto `flows.template_graph`, node row provisioning, template-triggered starts (`startFromTemplate`). |
| `EdgeActivator` (`runtime/edgeActivator.ts`) | Template edge activation: join all/any semantics, decision labels, JSONata edge conditions, real re-entry loops, inherited-input seeding from upstream `next`-edge outputs, auto-start of satisfying targets per trigger type. |
| `WaitScheduler` (`runtime/waitScheduler.ts`) | In-memory deadlines for `wait_for` triggers (`webhook`, `timer`, `comments`); the debounced resolve quiet period bounces on each new ingested comment. |
| `FlowReadModel` (`runtime/flowReadModel.ts`) | Snapshot assembly for the UI: flow + nodes + artifacts + branches + plan steps + hooks, with capabilities projected via `uiCapabilities`. |
| `CommentIngestor` (`runtime/commentIngestor.ts`) | Git-host webhook/comment ingestion: MR → flow lookup (branch rows first, then flow-level MR), dedup, open/close status transitions. |

The narrow host interfaces each collaborator consumes are declared in `runtime/flowEngineHost.ts` (`WaitSchedulerHost`, `EdgeActivatorHost`, …) — collaborators never see the full engine.

The engine itself keeps: the SDLC builtin chain (`chains/sdlcChain.ts` — `approvePlan`, `approveBuild`, `triggerPipelineGate`, `triggerReview`, `triggerResolve`), node claiming and background execution (`claimNode`, `bg`), plan-step editing, fan-out/split unit actions (`approveFanoutStep`, `skipFanoutStep`, `approveSplitUnit`, …), and generic actions (`runNodeManual`, `approveNode`, `chooseNode`, `setNodeConfig`).

### Run lifecycle

1. An edge activates or an action triggers → `startNodeStage` → `runNode`.
2. `claimNode` flips the node to `running` with a fresh `attempt_id` (the supersede fence) and `bg` executes the bundle asynchronously.
3. The def's `triggerRuns(ctx)` yields one or more `NodeTriggerRun`s (multi-run for the sequential multi-branch build); each input is `parseInput`-validated.
4. The def's `run()` produces a `RunOutcome` persisted through the single door `applyOutcome` (artifact, validated output, status, lifecycle event).
5. Terminal success → `advanceFrom(flowId, key)` re-evaluates outgoing edges; fan-out/split parents finish through `finishFanout` / `finishSplit`.

A late-finishing run whose `attempt_id` no longer matches the node row is fenced by `RunSupersededError` (`errors/runSupersededError.ts`) and persists nothing.

### Background runtime

| Piece | Role |
|-------|------|
| `FlowPoller` (`runtime/flowPoller.ts`) | 30 s tick over active flows: `processWaitTimers`, due `schedule` template triggers (`scheduleTrigger.nextScheduleFireAt` advances in whole intervals — no drift), reconciler pass, then per-MR pipeline + discussion polling via the git host port. New open comments bounce the resolve debounce. Poller startup also runs the one-time worktree sweep, stuck `step_merges` sweep, and wait-timer re-arm. |
| `Reconciler` (`runtime/flowReconciler.ts`) | Re-syncs nodes stuck in `running` with their real agent run (local: re-attach to persisted workspace state; cloud: query the Cursor API by durable run handle), throttled 20 s per flow. Recovery delegates to the def's `recover()`. |
| `NodeStore` / `HookStore` / `CommentStore` / `PlanStepStore` (`runtime/*.ts`) | Table access layers for engine orchestrators; node kinds use `NodeSupport` instead (see `node-infra.md`). `HookStore` binds inbound webhooks to templates or waiting nodes (`standardwebhooks` verification or shared-secret fallback, delivery dedup by `webhook-id`). |
| `WorktreeManager` / `WorktreeStatusService` (`runtime/worktreeLifecycle.ts`, `worktreeStatusService.ts`) | Local-mode worktree binding, setup, crash-safe removal, and the worktree-status read model — see `git.md`. |
| `GraphService` (`graph/graphService.ts`) | Resolves the workflow graph payload for `GET /api/graph` — builtin registry graph, a template's stored graph, or a flow's snapshot. |
| Flow context (`context/flowVariables.ts`) | The single variable universe (`task`, `repo`, `flow`, `trigger`, `nodes`, `input.unit`) every JSONata expression and `{{...}}` template evaluates against. `secrets` is deliberately excluded — secret values resolve only inside http-node config interpolation at execution time. |

### Flow deletion

`delete` removes the flow-owned tables in FK-safe order (`FLOW_CHILD_TABLES`: `step_merges`, `plan_steps`, `events`, `messages`, `runs`, `artifacts`, `comments`, `branches`, `nodes`, `hooks`, then `flows`), plus worktree cleanup.

## API surface

### HTTP

| Route | Engine entrypoint |
|-------|-------------------|
| `GET /api/flows`, `POST /api/flows` | `list`, `FlowFactory.create` |
| `GET /api/flows/:id`, `DELETE /api/flows/:id` | `get`, `delete` |
| `POST /api/flows/:id/action` | action dispatch: `approvePlan`, `approveBuild`, `approveNode`, `runNodeManual`, `retryNode`, `cancel`, `updatePlanSteps`, `setPlanStepStatus`, fan-out/split unit actions, `chooseNode`, `setNodeConfig` |
| `POST /api/flows/:id/chat` | `sendChat` → the node's `turn`/`chat`/`converse` |
| `GET /api/flows/:id/events` | event feed read |
| `GET /api/flows/:id/comments` | ingested comment read |
| `GET /api/flows/:id/prompt`, `GET /api/flows/:id/prompts` | prompt preview (`prompts/promptPreview.ts`) |
| `GET /api/flows/worktree-status` | `WorktreeStatusService` |
| `GET /api/graph` | `GraphService.resolve` |
| `POST /api/webhooks/gitlab` | `handleHostEvent` → `CommentIngestor` + pipeline gate trigger |
| `POST /api/hooks/:id` | generic inbound hook delivery → template start or node resume |

### Flow actions

Actions arrive as `POST /api/flows/:id/action` bodies validated by `lib/schemas/flowActionBody.ts`. Builtin-approval nodes (`plan`, `build`) route to `approve_plan` / `approve_build`; every other hold uses the generic `approve_node`. `run_node` on the plan node is rejected — plan generation is chat-only.

## Data model

Engine-owned tables (see `database.md` for the access layer): `flows` (with `template_graph` snapshot), `nodes` (status, `input`, `output`, `attempt_id`, config snapshot), `runs` (token/cost rollup via `utils/runTokenRollup.ts`), `artifacts`, `events`, `messages`, `comments`, `branches`, `plan_steps`, `step_merges`, `hooks`, `hook_deliveries`.

## Out of scope

- Node-kind internals — see the per-node docs (`plan-node.md`, `build-node.md`, …) and `node-infra.md`.
- Agent execution and streaming — see `agent-harness.md`.
- Template storage/lint — see `templates.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Orchestrator | `lib/engine/flowEngine.ts` |
| Flow creation | `lib/engine/runtime/flowFactory.ts` |
| Edge activation / joins | `lib/engine/runtime/edgeActivator.ts` |
| Wait triggers | `lib/engine/runtime/waitScheduler.ts` |
| UI snapshot | `lib/engine/runtime/flowReadModel.ts` |
| Restart recovery | `lib/engine/runtime/flowReconciler.ts` |
| Background tick | `lib/engine/runtime/flowPoller.ts` |
| Webhook/comment ingest | `lib/engine/runtime/commentIngestor.ts` |
| Inbound hooks | `lib/engine/runtime/hookStore.ts` |
| SDLC builtin chain | `lib/engine/nodes/chains/sdlcChain.ts` |
| Graph payload | `lib/engine/graph/graphService.ts` |
| Flow context variables | `lib/engine/context/flowVariables.ts` |
