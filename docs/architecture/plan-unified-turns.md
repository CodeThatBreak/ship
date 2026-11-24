# Plan unified turns

All plan-mode agent turns go through one user-facing send — `POST /api/flows/:id/chat` — and one engine turn handler, `PlanNode.turn()`. There is no separate first-run route and no branch/thread routing: the plan is a single conversation about one plan document.

## Routing

Routing depends only on whether a published plan artifact exists:

| State | Turn kind | Prompt |
| --- | --- | --- |
| No plan artifact yet | `pre-publish` | `plan` template, with the user message as the editable body (`promptIsBody`) |
| Plan artifact exists | `whole` | `plan_refine`, with the developer message in `{{feedback}}` |

`PlanNode.turn()` records the resolved turn kind, user message, pre-claim status and exact prompt in `nodes.input` (`PlanInput`) so a retry or recovery can replay the same turn.

## Output envelope

Every plan turn returns one JSON object:

```ts
PlanTurnOutput = {
  reply: string;             // required — the answer shown in chat
  plan?: PlanResponse | null; // optional — publish a new plan version
}
```

A reply-only turn changes nothing. A plan-bearing turn publishes a new artifact version and syncs the editable checklist from `PlanResponse.steps`.

`PlanResponse` is a full plan document: `markdown` plus a non-empty `steps` array. The only plan-domain refinement is unique step ids (filled as `s1, s2, …` by `withStepIds`), so a violation rides the same schema-issues payload and bounded retry feedback as any other contract miss.

## Apply path

`PlanOutputContract.applyTurnResult` parses the envelope, then:

1. Reply-only → no write; the turn reverts to its pre-claim status via the declared `chatRevert` transition.
2. Plan-bearing → the §3b apply guard checks node ownership/status; a valid plan is persisted by `PlanStore.persistPlan` (artifact meta `{ feedback, steps, refinedFrom }`), the checklist is synced, and the outcome waits for approval.

A single bounded feedback retry (`AgentOutputPipeline`) re-prompts the same agent on a retryable contract miss; the retry prompt appends exactly the schema-generated directive advertised by the `plan` and `plan_refine` templates (`AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA)`).

## Recovery

`PlanNode.recover()` replays a finished turn from the recorded `PlanInput` (`planTurnKind`, `turnUserMessage`, `previousStatus`) plus the agent text — the same `applyTurnResult` path, never a separate legacy replay.

## Prompts

- `plan` — the first-turn body with `{{ticket}}` / `{{ticket_type}}`; internal blocks carry the generated output contract and the step-authoring rules.
- `plan_refine` — the follow-up body with `{{feedback}}` and the assembled `{{context}}`.

`{{context}}` is assembled server-side from the registered blocks (`task`, `edits`) — an empty selection uses the defaults, and an explicit selection wins. Developer hand edits to the checklist are passed as intent the refine must respect.

## UI

`PlanNodeChat` renders a single chat rail; `usePlanComposer` supplies the prompt prefill from one bounded bulk read. `PlanView` shows version tabs, the plan document and the editable step checklist; diffs between versions come from `branchDiff.ts` helpers over the artifact meta's `steps`.
