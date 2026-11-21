# Plan: Declarative agent nodes run chat-first (AgentView loses its prompt card + Run button)

## Goal

The declarative `agent` kind (every `node_templates` row with `kind='agent'`) behaves like the
built-in agentic nodes (`plan`, `build`, `review`, `resolve`, `pipeline`): the node's first run
is driven from the chat rail — the composer prefills with the rendered prompt, the first message
**is** the prompt body — and later messages are refine turns. `AgentView` loses the prompt card
and the footer Run button; the Configure dialog stays as the durable instance-config editor
(`nodes.config.prompt`, with `{{vars}}`), which is a different surface from a one-shot run body.

This extends `docs/make-agentic-node-consitent.md` (which deliberately scoped declarative `agent`
nodes out, Phase 1.5) to the last chat-inconsistent node kind.

## Why this is mostly wiring, not new machinery

- The composer-as-prompt prefill is **already generic and capability-gated**:
  `useNodePromptPrefill` (`components/flows/panels/hooks/useNodePromptPrefill.ts:46-52`) reads
  `node.capabilities?.promptNode`, fetches `useNodePrompt(flow.id, promptKey ?? node.node_key)`
  only on a first run, and `NodeChat.tsx` passes `initialDraft` / `sendLabel` / placeholder to
  `ChatPanel`. Adding `promptNode` to the agent kind's capabilities lights the whole path up
  with **zero frontend changes**.
- The prefill source already exists for the agent kind: `AgentTemplateNode.previewPrompt()`
  (`lib/engine/nodes/kinds/agent/agentTemplateNode.ts:137-159`) renders through the SAME
  `renderAgentPrompt`/`composeAgentPrompt` path `run()` uses, and `PromptPreview.previewFor`
  serves it at `GET /api/flows/:id/prompt?node=X` (tested in
  `declarativePreviewPrompt.test.ts`).
- The engine's first-turn semantics already exist as a shared helper:
  `AgentRunNode.isFirstTurn(node)` (`lib/engine/nodes/shared/agentRunNode.ts:98-103`) — a chat
  turn on a node with `output == null && status ∈ {pending, failed}` carries the prompt body,
  not feedback. `AgentTemplateNode.chat()` (`agentTemplateNode.ts:253-282`) simply never checks
  it today — it always treats the message as feedback (`renderAgentFeedback` +
  `followUpOn: lastAgentId`, which is null before the first run — the latent inconsistency).
- The chat dispatch is already generic: `flowChatService.sendChat` claims via `chatRefine` and
  advances the template edges when a first-turn chat run lands the node on a new success
  terminal (`flowChatService.ts:61-69`).
- Per-instance capability projection already works: `flowReadModel.ts:228` resolves declarative
  defs via `declarativeDef(n.type, n.nodeKey)` (instance key) and projects
  `uiCapabilities(def?.capabilities)` per node row, so a constructor-set
  `promptNode: this.key` reaches the UI correctly.

**Key semantic decision (from the prior doc, unchanged):** a chat turn on a never-run node is
the **prompt body**; a turn after a run is a **refine**. For the agent kind this needs no
`promptIsBody` flag: `renderAgentPrompt` (`agentPrompt.ts:82-121`) already treats
`rawInput.prompt` as the body override (`prompt_source: modal`) and `composeAgentPrompt`
appends the contract/split directives — the exact body semantics the other nodes get from
`promptIsBody: true`.

**What stays (and why):** the Configure dialog in `AgentView`. The doc's "out of scope" note
keep this deliberate: a declarative agent's prompt is *template config* — durable, per-instance,
`{{var}}`-templated, re-rendered on every run/refine. Chat's first-turn body is a one-shot run
input. Unlike the built-ins (whose prompts live in the PromptLibrary and are edited in the
template editor), the instance-level `nodes.config.prompt` override needs an editor in the
panel; that is exactly `SET_NODE_CONFIG` + the Configure dialog. (`useFlowMutation` already
invalidates `invalidateFlowPrompts` on `set_node_config`, so the composer prefill refreshes
after a save — `useFlowMutation.ts:22-24`.)

> **Decision change (follow-up):** the Configure dialog above was subsequently
> removed. Prompt editing is now chat-side only: the first-turn composer prefill
> is the prompt body, later messages are refine turns, and `AgentView` no longer
> dispatches `set_node_config`. The `{{var}}`-templated prompt remains editable in
> the template editor's `NodeConfigurator`; a chat edit is a one-shot run input.

---

## Phase 1 — Engine: agent kind first-turn = prompt-body run

### 1.1 `AgentTemplateNode` capabilities + `chat()` (`lib/engine/nodes/kinds/agent/agentTemplateNode.ts`)

- Capabilities: declare `promptNode` and `startLabel`. `promptNode` must be the **instance key**
  (`this.key = instanceKey ?? tmpl.id`, set in the `DeclarativeAgentNode` constructor), not a
  static def key — built-ins use `NODE_KEYS.X`, declarative instances are per-row. Set it in the
  constructor (the field is `readonly`, assigned once):

  ```ts
  override readonly capabilities: NodeCapabilities;
  // in the constructor, after super(...):
  this.capabilities = { refinable: true, promptNode: this.key };
  ```

  No `startLabel` string constant exists for agent kinds; add one to
  `lib/engine/nodes/kinds/agent/constants/` per AGENTS §3.2 (a class file stays pure — no
  module-level constants parked in it). Suggested: `startLabel: "Run agent"` matches the other
  kinds' labels ("Run AI review", "Start build", …). The label itself is
  `capabilities.startLabel`, set in the constructor alongside `promptNode`.

- `chat()`: add the first-turn branch at the top, mirroring `reviewNode.chat()`
  (`reviewNode.ts:389-399`):

  ```ts
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (this.isFirstTurn(await this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        { prompt: content, model: model ?? null },
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    // …existing feedback path (renderAgentFeedback + followUpOn) unchanged…
  }
  ```

  The input schema (`AgentRunInput`, `schema.ts:14-17`) is a `z.looseObject` with `prompt`
  already declared, so `{ prompt, model }` parses without changes — no `promptIsBody` addition
  needed (see "Key semantic decision" above).

### 1.2 No other engine changes needed

`flowChatService`, `nodeRoles.chatRefinerOf` (already gates on `refinable: true`, which the
agent kind declares), `PromptPreview`, the chat route, and the retry path
(`retryPromptRebuild.ts` — declarative agent retries keep replaying their recorded prompt, the
`promptIsBody`-stripping list covers only built-ins) are all already correct.

### 1.3 Engine tests (AGENTS §0: new behavior needs tests)

Extend `lib/engine/nodes/chatFirstTurn.test.ts` — it already stubs `NodeSupport`/`AgentRunner`
and asserts the first-turn contract for review/resolve/pipeline/build, plus the capabilities
projection (`chatFirstTurn.test.ts:201-209`):

- Construct an `AgentTemplateNode` with a markdown-output config (simplest — no contract
  directive) and one with a json `output_schema` (asserts the directive appends on the
  first-turn body too).
- First `chat()` on a never-run (pending, `output: null`) node → the runner receives the
  composed prompt whose body IS the chat message; the recorded input blob carries
  `{ prompt: content, prompt_source: "modal" }` (the body override — never an `instructions`
  refine).
- A json-output agent's first-turn prompt still ends with the `RESPONSE FORMAT` contract
  directive (`composeAgentPrompt` appends it) — the refine path already asserts this pattern.
- Second `chat()` after a run → the refine mapping (`feedback` + `followUpOn` set), no prompt
  override.
- `isFirstTurn` edge: a failed node with `output: null` → still first-turn; a node with output →
  refine.
- Capabilities: `def.capabilities.promptNode === def.key` for an instance-keyed agent def, and
  `startLabel` projects through `uiCapabilities()`.

---

## Phase 2 — Frontend: slim `AgentView`

### 2.1 `components/flows/panels/views/AgentView.tsx`

- **Delete the prompt card** (`AgentView.tsx:84-98`) — the composer prefill now shows the same
  rendered prompt, editable, before the first run. This also removes the `!fannedOut &&` gating
  for the card (the `FanoutStepList` branch stays).
- **Delete the footer Run button** (`AgentView.tsx:71-75`) — the composer's send IS the run's
  start action on a pending/failed-with-no-output node. Keep the Approve button and the footer
  copy; adjust the `pending` copy from "Run this … step to produce the node's output" to point
  at the chat ("Review the prompt in the chat, then send to run").
- **Keep the Configure dialog** (`headerEnd` pencil + `<Dialog>`) — the durable instance-config
  editor (`nodes.config.prompt` with `{{vars}}`), per the decision above. Keep `SET_NODE_CONFIG`
  (already invalidates prompt queries via `useFlowMutation`).
- **Delete the now-dead `pending`/`cfg.mode` footer branch pieces** that only the Run button
  used; keep `failed` copy ("The run failed — …"), which now also resolves through the composer
  (failed + no output = first turn per `isFirstTurn`).
- `EmptyHint` (`AgentView.tsx:104-106`): drop the `pending ? 'Click Run to start.'` clause — the
  composer is the affordance now.

### 2.2 No changes needed

`NodeChat`, `useNodePromptPrefill`, `ChatPanel`, `useNodePrompt`, the chat route, and
`panelFactory.resolveChat` are untouched — the prefill is capability-driven. `StartView` keeps
its own Run flow (entry node, not refinable — out of scope).

### 2.3 Frontend tests

`tests/nodePromptPrefill.test.ts` covers `isNodeFirstRun` — no change needed (the predicate is
unchanged; the agent kind opts in via capabilities). If `AgentView` grows no test, that matches
today (no view-level test exists); the behavior change is deletion + capability opt-in, covered
by the engine tests.

---

## Phase 3 — Docs

- `docs/make-agentic-node-consitent.md` — amend the Phase 1.5 "Out of scope" bullet
  (declarative `agent` nodes): they are now in scope (this plan). Keep the historical note,
  add a pointer.
- `docs/architecture/declarative-nodes.md` — update the **UI architecture** section (AgentView
  no longer shows a prompt card / Run button; first run goes through the chat rail like the
  built-ins) and the **API surface** table (`run_node` no longer dispatched from AgentView;
  `set_node_config` stays).
- Flag (don't rewrite) the AgentView line-number references in `docs/review-tasks/15-…`,
  `35-…`, `52-…`, `55-…` and `docs/code-review.md` in the PR description (AGENTS §4 — those are
  historical findings; CR-123 / CR-027 touch the prompt card / Configure invalidation).

---

## Phase 4 — Verify (Definition of Done, AGENTS §0)

- `npm run typecheck && npm run lint && npm test && npm run build` all pass.
- Manual smoke on the demo DB: `node scripts/seed-custom-flow.mjs` (DEMO-201 — a declarative
  agent flow), then:
  1. pending agent node → composer prefilled with the rendered prompt → edit → send → node runs
     with the edited body;
  2. second message → refine turn (feedback + follow-up session);
  3. failed-with-no-output node → composer prefilled again (first-turn retry);
  4. Configure dialog still edits the durable config prompt and the prefill reflects it after
     save;
  5. `run_node` no longer appears in the agent panel; approval-triggered instances still hold at
     `awaiting_approval` with the Approve button.

---

## Risks / decisions to confirm

1. **Run button removal** is the visible UX change: the "just re-run with the stored config
   prompt" path moves into the composer (failed + no output prefills; done/failed-with-output
   refines). The prior doc kept the footer Run buttons for review/resolve/pipeline as a plain
   re-run path — but those dispatch `FLOW_ACTION.*` **without** a prompt, which for an agent
   node means "run the config prompt", exactly what a first-turn chat send with an unedited
   prefill does. If you'd rather keep a no-prompt re-run button too, say so and Phase 2.1 keeps
   it (one line).
2. **`startLabel` copy** — "Run agent" is proposed; the built-ins use node-specific labels.
   `promptNode: this.key` is required (instance key), not a static string — flagged because it
   differs from the built-ins' `NODE_KEYS.X`.
3. **First-turn detection** relies on `output == null && status ∈ {pending, failed}` (shared
   `isFirstTurn`) — a node that fails *after* publishing output correctly falls back to refine
   turns, matching the built-ins.
