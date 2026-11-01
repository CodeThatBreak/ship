# Plan: All agentic nodes run via chat (delete PromptModal)

## Goal

Every agent-backed node (`plan`, `build`, `review`, `resolve`, `pipeline`) behaves like `PlanNode`: the node is driven entirely through `POST /api/flows/:id/chat` → `flowEngine.sendChat()` → `def.turn()`. The composer's first message **is** the node's prompt (prefilled, editable); later messages are refine turns. `PromptModal`, its hook, and the `prompt`/`promptIsBody` action-route plumbing are deleted.

## Why this is mostly wiring, not new machinery

- Chat dispatch is already fully generic: `app/api/flows/[id]/chat/route.ts:24` → `flowEngine.sendChat` (`lib/engine/flowEngine.ts:1078`) → `nodeRoles.chatRefinerOf(def)?.turn(...)` — gated only on `capabilities.refinable` (`lib/engine/nodes/shared/nodeRoles.ts:95`).
- `AgentRunNode` already provides `turn()` → `chat()` → `run(chatInput(...))` (`lib/engine/nodes/shared/agentRunNode.ts:67-82`); review/resolve already refine via chat today (`chatInput()` maps to `instructions`).
- The prefill source already exists for every node: `GET /api/flows/:id/prompt?node=X` → `PromptPreview.previewFor` → each node's `previewPrompt()` (review `reviewNode.ts:89`, resolve `resolveNode.ts:61`, pipeline `pipelineNode.ts:300`, build `buildNode.ts:473`). `useNodePrompt` already exists (`hooks/useFlowChat.ts:42`).
- `ChatPanel`/`ChatComposerForm` already support everything needed: `initialDraft`, `sendLabel`, `placeholder`, `loading`, `error` (`ChatPanel.tsx:88-99`).
- The `capabilities.promptNode` field already exists ("the prompt-route node key the chat's prompt preview/editor targets", `capabilities.ts:86`) but has **no frontend reader** — it is the designed seam for exactly this.

**Key semantic change:** for review/resolve/pipeline/build, a chat turn on a node that has never run treats the message as the **prompt body** (`{ prompt: content, promptIsBody: true }` — the exact input shape the modal produces today); a turn after a run stays a **refine** (`instructions`/`guidance`/`feedback` — current behavior). Plan's precedent: pre-publish turn = body (`planNode.ts:181-197`), later turns = refine.

---

## Phase 1 — Engine: first-turn = prompt-body run

### 1.1 Shared "has run" helper

Add a protected helper on `AgentRunNode` (`lib/engine/nodes/shared/agentRunNode.ts`), e.g.:

```ts
/** A chat turn before the node's first run carries the prompt body, not feedback. */
protected isFirstTurn(node: NodeRow): boolean {
  return node.output == null && (node.status === 'pending' || node.status === 'failed');
}
```

(Genuine shared polymorphic behavior → base class, per AGENTS §3.2. Status values come from the existing flow-status constants, not literals.)

### 1.2 ReviewNode (`lib/engine/nodes/kinds/review/reviewNode.ts`)

- Override `chat()`: if `isFirstTurn(node)` → `run()` with `ReviewInput.parse({ prompt: content, promptIsBody: true, model: model ?? null })`; else `super.chat(...)` (existing `instructions` refine, `reviewNode.ts:262`).
- Capabilities: add `promptNode: NODE_KEYS.REVIEW` and `startLabel: 'Run AI review'` (see 1.6).
- No `recover()` change needed: the recorded input blob is the same shape the modal recorded (`{prompt, promptIsBody}`).

### 1.3 ResolveNode (`lib/engine/nodes/kinds/resolve/resolveNode.ts`)

- Same pattern: first turn → `ResolveInput.parse({ prompt: content, promptIsBody: true, model })`; else `super.chat()` (existing `instructions` refine, `resolveNode.ts:263`).
- Capabilities: `promptNode: NODE_KEYS.RESOLVE`, `startLabel: 'Resolve comments'`.

### 1.4 PipelineNode (`lib/engine/nodes/kinds/pipeline/pipelineNode.ts`)

- Its `chat()` is already a bespoke override (`pipelineNode.ts:651`, reruns with `guidance`). Add the first-turn branch at the top: first turn → run with `{ prompt: content, promptIsBody: true, model }` (same input `triggerPipelineGate` passes today); otherwise fall through to the guidance path.
- Capabilities: `promptNode: NODE_KEYS.PIPELINE`, `startLabel: 'Run pipeline'`.

### 1.5 BuildNode (`lib/engine/nodes/kinds/build/buildNode.ts`) — the one non-trivial node

Build never used the modal, and its first run needs the approved plan:

- Add `promptIsBody: z.boolean().default(false)` to `BuildInput` (`build/schema.ts:13-31`) so a chat body-run matches the other nodes; in `run()`, add the `promptIsBody` branch to the existing `prompt` handling (`buildNode.ts:244-247`) using `prompts.assemblePrompt(..., { body: input.prompt, userRules })` exactly like review/resolve/pipeline do.
- Override `chat()`: first turn → pull the approved plan from the plan node's published output (reuse the same upstream read the chain's approve path uses; extract a small helper if it lives inside `sdlcChain`) and run `{ plan, prompt: content, promptIsBody: true, model }`; else existing `feedback` refine.
- Capabilities: add `promptNode: NODE_KEYS.BUILD`, `startLabel: 'Start build'` (keep existing `panelTitle`, `fanoutOutput`, `mergeBack`).
- **Out of scope:** `step_build` first-turn (step children are engine-spawned via fan-out; chat refine already works), `decision` (deliberately not refinable), declarative `agent` nodes (already chat-capable; prompt editing stays in AgentView's Configure dialog).

### 1.6 Capabilities plumbing

- `lib/engine/nodes/shared/capabilities.ts`: add `startLabel?: string` to `NodeUiCapabilities` with doc comment; include it in the `uiCapabilities()` projection (`capabilities.ts:120-130`).
- `types/nodeCapabilities.ts` (frontend mirror imported by `ChatPanel.tsx:7`): add `startLabel?` (and `promptNode?` if absent).
- `PlanNode`: add `startLabel: 'Generate plan'` for consistency (replacing any hardcoded copy downstream).

### 1.7 Engine tests (AGENTS §0: new behavior needs tests)

Following the existing node-test patterns (e.g. `buildPromptParity.test.ts`, plan tests):

- Per node (review/resolve/pipeline/build): first `chat()` on a never-run node → runner receives the assembled prompt with the typed body (`promptIsBody` semantics: internal blocks appended); second `chat()` → refine input (`instructions`/`guidance`/`feedback`), no prompt override.
- `isFirstTurn` edge: failed node with no output → still first-turn; node with output → refine.

---

## Phase 2 — Frontend: composer prefill in `NodeChat`

### 2.1 `components/flows/panels/NodeChat.tsx` (currently 30 lines, no seam)

Gate everything off capabilities — **no node-key checks** (AGENTS; mirrors plan's comment at `planNode.ts:67-72`):

```tsx
const promptKey = node.capabilities?.promptNode ?? null;
const firstRun = node.output == null && (node.status === FLOW_STATUS.PENDING || node.status === FLOW_STATUS.FAILED);
const promptQuery = useNodePrompt(flow.id, promptKey ?? node.node_key, { enabled: promptKey != null && firstRun });
```

- `promptKey && firstRun && promptQuery.isPending` → `ChatPanelSkeleton` (mirrors `PlanNodeChat.tsx:42-44`).
- Error → ChatPanel's existing `error` slot with retry (AGENTS §2.8).
- Pass: `initialDraft={firstRun ? promptQuery.data?.prompt : undefined}`, `sendLabel={firstRun ? capabilities?.startLabel ?? 'Send' : 'Send'}`, first-run placeholder ("Review the prompt, then send to run").
- `useNodePrompt` (`hooks/useFlowChat.ts:42`): add an `enabled` option if it doesn't take one.
- If `NodeChat.tsx` grows past ~80 lines, extract `hooks/useNodePromptPrefill.ts` in the panels feature per AGENTS §2.2.

### 2.2 No changes needed

`ChatPanel`, `ChatComposerForm`, `useChatComposer`, `useSendChatMessage`, the chat route, and `panelFactory.resolveChat` stay untouched — plan keeps `PlanNodeChat` (branch threads), everything else uses the upgraded `NodeChat`.

### 2.3 Deliberate UX change to confirm

Per-flow **rules editing** (`prompt_rules`) currently lives only in the modal. After deletion it moves to the settings/template config surface (where plan's `promptSections` already live). No replacement UI is built in this plan.

---

## Phase 3 — Remove modal usage from the three views

Identical edit in each — delete `showPrompt` state, the `Pencil` "Edit prompt" `headerEnd` button, and the `<PromptModal>` render + import:

- `components/flows/panels/views/ReviewView.tsx` (lines 4, 19, 31-35, 102-113; check `Pencil` import on line 3)
- `components/flows/panels/views/ResolveView.tsx` (lines 5, 17, ~31, 59-69)
- `components/flows/panels/views/PipelineView.tsx` (lines 6, 18, ~24, 57-67)

Keep the footer action buttons (`Run AI review`, `Resolve N comments`, pipeline re-run) — they dispatch `FLOW_ACTION.*` **without** a prompt and remain the plain re-run path.

---

## Phase 4 — Delete dead code

1. `components/chat/promptModal/` — entire directory (7 files): `PromptModal.tsx`, `PromptEditorSection.tsx`, `RulesSection.tsx`, `LockedSection.tsx`, `FinalPromptFooter.tsx`, `PromptModalSkeleton.tsx`, `hooks/useToggledSections.ts`. Sole consumer was the three views.
2. `components/chat/hooks/useFlowPrompt.ts` — sole consumer was `PromptModal`.
3. `scripts/fix-feature-barrel-imports.mjs` — remove the two `PromptModal` map entries (lines 91, 137).
4. **Action-route prompt plumbing** (per AGENTS §6 "current flow only" — no shims for the retired path):
   - `lib/schemas/flowActionBody.ts`: drop `promptFields` from the `REVIEW`/`RESOLVE`/`PIPELINE` variants (keep on any variant that still needs it); update `lib/schemas/flowActionBody.test.ts`.
   - `lib/engine/flowEngine.ts`: trim `prompt`/`promptIsBody` params from `triggerReview`/`triggerResolve`/`triggerPipelineGate` (~line 780).
   - `lib/engine/nodes/chains/sdlcChain.ts:150-198`: trim the same params from the three chain triggers; `runNode` inputs no longer pass `prompt`/`promptIsBody` (chain auto-runs use the default template, as before).
   - **Keep** `prompt`/`promptIsBody` in the node _input_ schemas — chat turns now produce them.
5. **Keep (still used):** `/api/flows/[id]/prompt` + `/prompts` routes, `PromptPreview` service, all `previewPrompt` methods, `useNodePrompt`/`useFetchAllNodePrompt`, `invalidateFlowPrompts` (used by `useFlowMutation` + `frontendMutationConventions.test.ts`), `SET_NODE_CONFIG` (AgentView), `components/shared/Modal` (BuildModal, FormModal).

---

## Phase 5 — Docs

Update the API tables and "Edit prompt" references in `docs/architecture/review-node.md` (~lines 50, 76, 98, 150), `resolve-node.md` (~99, 153), `pipeline-node.md` (~80-212), `build-node.md` (~172 `useFlowPrompt`), and the modal references in `docs/plan-conversation-refine.md` §4d. Flag (don't rewrite) the historical mentions in `docs/code-review.md` and review-tasks 15/52/54 in the PR description.

---

## Phase 6 — Verify (Definition of Done, AGENTS §0)

- `npm run typecheck && npm run lint && npm test && npm run build` all pass.
- Manual smoke on the demo DB: `node scripts/seed-demo-flow.mjs`, then for review/resolve/pipeline/build: composer prefilled before first run → edit → send → node runs with the edited prompt; second message → refine turn; footer re-run buttons still work; plan flow unchanged.

---

## Risks / decisions to confirm

1. **Build first-turn** is the only real new engine logic (plan lookup + `BuildInput.promptIsBody`). If you'd rather keep build approval-triggered for now, Phase 1.5 + its composer prefill can be deferred without blocking the modal deletion.
2. **Rules editing** loses its per-flow UI (moves to settings config) — confirm acceptable.
3. **First-turn detection** relies on `output == null && status ∈ {pending, failed}`; a node that fails _after_ publishing output correctly falls back to refine turns.
