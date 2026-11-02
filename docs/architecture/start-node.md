---
node_key: start
kind: builtin
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Start node

## Summary

The start node is a template's entry point — the branch trigger with no incoming edge. It carries the template's **start contract**: the declared fields a flow starts with, one list serving as both input and output. Whatever the trigger provides is validated against the contract and published as the node's output, so downstream nodes map from those variables (`{{nodes.start.output.*}}`). Without a declared contract it finishes immediately and publishes nothing.

## Capabilities contract

| Field | Value | UI / engine effect |
|-------|--------|-------------------|
| `refinable` | — | No chat rail; the start node has no agent. |
| `chatMode` | — | — |
| `promptNode` | — | — |
| `panelTitle` | `Flow start` | Panel header title. |

Engine-only:

- `isEntry: true` — the engine keys flow-start behavior off this flag, never the literal key (`NodeRegistry.entryKey()`).
- `order: 5` — ahead of plan (10) so graphs display flow entry first.
- `retryable: false` — nothing to recover; a start run completes synchronously in one stage.
- Contract knobs are edited through the configurator's dedicated `StartContractEditor`, not the generic config form (`configFields` stays empty).

## User-visible phases

### Phase 1 — Pending (manual / approval trigger)

- **Entry:** Flow created from a template whose start trigger is manual or approval, with a declared contract.
- **Surface:** `StartView` — one form field per contract entry, prefilled with authored defaults.
- **Action:** `Start flow` → `run_node` with the form values as `input`.
- **Outcome:** Values validated against the contract; the node publishes them and finishes `done`; outgoing edges activate the rest of the template. A contract violation fails the node loudly with the validation message.

### Phase 2 — Auto / webhook / schedule trigger

- **Entry:** Auto flows (the node runs itself on flow start with authored defaults), a webhook delivery, or a schedule fire (`startFromTemplate`).
- **Surface:** None — the panel simply shows the published values afterwards.
- **Action:** None. A webhook payload that violates the contract is rejected outright at the route boundary.
- **Outcome:** Same as Phase 1 — validated values published, node `done`.

### Phase 3 — Done

- **Surface:** `StartView` lists the published variables — the contract keys and their values, which downstream nodes address through the flow context.
- **Outcome:** Terminal; nothing further to do.

## UI architecture

### Workspace routing

`components/flows/panels/panelFactory.tsx`: `node.type === 'start'` → `StartView`. Chat rail: none (no `refinable` capability).

### Panel (`StartView`)

- Parses the contract from `node.config` via `parseStartContract` (shared client-safe module `types/startContract.ts` — the engine's `lib/engine/nodes/kinds/start/contract.ts` is a thin re-export so client code never imports `lib/engine`).
- Local `useState` for form values, prefilled from authored defaults; submit dispatches `FLOW_ACTION.RUN_NODE` through the panel context's `action`.
- Contract authoring lives in the template editor: `components/templateEditor/components/configurator/contract/StartContractEditor.tsx`.

### Async states

- Pending: the form with a `Start flow` button (disabled while submitting).
- Failed: error banner with the contract violation; the form remains for correction and re-trigger.
- Done: the published-values list.

### Key files

- `components/flows/panels/views/StartView.tsx`
- `components/flows/panels/panelFactory.tsx`
- `components/templateEditor/components/configurator/contract/StartContractEditor.tsx`
- `types/startContract.ts`

## Backend architecture

### Node class

`StartNode` (`lib/engine/nodes/kinds/start/startNode.ts`) extends `NodeDefinition` directly — not `AgentRunNode` (no agent involved).

### Run lifecycle

1. `triggerRuns(ctx)` seeds the input from `ctx.flow.trigger_payload` (webhook delivery body / schedule fire payload; `{}` for manual flows, whose input comes from the form).
2. `run()` parses the contract from config (`parseStartContract`), validates the input (`validateAgainstContract`), and throws on violation — the engine marks the node failed, and a webhook-driven `startFromTemplate` rejects the delivery.
3. Success publishes the validated values via `applyOutcome` (`status: 'done'`, event `Flow started — publishing …`).

`recover()` returns `true` unconditionally — a start run finishing while the server was down is just done.

### Key files

- `lib/engine/nodes/kinds/start/startNode.ts`
- `lib/engine/nodes/kinds/start/contract.ts` (engine seam → `types/startContract.ts`)

## API surface

### HTTP

| Route | Caller | Purpose |
|-------|--------|---------|
| `POST /api/flows/:id/action` | `StartView` | `run_node` with the contract form values |
| `POST /api/hooks/:id` | External senders | Webhook delivery → `startFromTemplate` (payload validated against the contract) |
| `POST /api/templates/:id/validate` | Template editor | Contract + trigger binding validation |

### Flow actions

| Action | When | Engine |
|--------|------|--------|
| `run_node` | User submits the start form | `runNodeManual` → `StartNode.run` |

### Actions not used

- `approve_node` — the start node never holds for approval itself (approval trigger type gates the *flow start*, handled by the form, not a node hold).
- Chat — no `refinable` capability.

## Data model

### Input

`z.record(z.string(), z.unknown())` — the trigger payload or form values, validated field-by-field against the contract (`key`, type, required, default).

### Output

The validated contract values — published as `nodes.start.output.*` and consumed downstream via the flow context map (`lib/engine/context/flowVariables.ts`).

### Side effects

None — no artifacts, no agent runs, no worktrees.

## Out of scope

- Task-provider intake that prefills flow creation (Jira) — see `task-providers.md`.
- The template editor's trigger configuration UI — see `templates.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Node class | `lib/engine/nodes/kinds/start/startNode.ts` |
| Contract schema/validation | `types/startContract.ts` |
| Panel | `components/flows/panels/views/StartView.tsx` |
| Contract editor | `components/templateEditor/components/configurator/contract/StartContractEditor.tsx` |
| Flow context variables | `lib/engine/context/flowVariables.ts` |
