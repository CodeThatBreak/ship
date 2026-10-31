# Conversational Plan Refinement — the composer is the plan's one input

> **Superseded (2026-10-31):** Shipped behavior and the `PlanTurnOutput` envelope live in
> `docs/architecture/plan-unified-turns.md` and `docs/architecture/plan-node.md`. Keep this
> file for historical design context only.

Date: 2026-10-29 · Status: **superseded — see plan-unified-turns.md**

> Companions: `docs/refinement-plan.md` (overall refine model), `docs/branch-scoped-refine.md`
> (scoped sub-plan refines — unchanged here; its Phase C "chat scope chip" direction is
> superseded — this doc makes the plan conversation a single surface instead; branch tabs
> going conversational is a listed future extension, §9). This doc changes how the plan
> node's chat works after the first run.
>
> Try it after Phase 2: open a fresh plan flow — the composer opens prefilled with the plan
> prompt (it IS the prompt), edit and send; after the first version every change happens in
> the same composer as a conversation. No prompt box, no modal, no mode toggle.

## Problem

Today the plan node has **two refinement surfaces with different semantics**, and the UI never
says which one you're using:

| Surface | Mechanics | Agent | Version effect |
|---|---|---|---|
| Chat + refine toggle | message → `chat()` → `{ feedback }` → `plan_refine` template | follows up on the plan agent | full plan re-emit, version bump |
| "Edit prompt" modal | prompt body override + `promptIsBody` + `feedback: ""` (`PlanView.runWithPrompt`) | fresh-ish run, internal blocks re-appended | full plan re-emit, version bump, **no provenance recorded** |

Consequences: users can't tell where their instructions go, the pencil toggle is easily missed
(and easily forgotten before sending), a modal rerun shows no "what changed / who changed it"
attribution, and a whole-plan chat refine produces a new version with **no diff banner** — only
branch-scoped refines get one. `docs/branch-scoped-refine.md` already documents the drift risk
of whole-plan re-emits; the review layer fixes the observability half.

## Design: four decisions

a. **The composer IS the prompt.** Before the first plan exists, the chat composer is
   prefilled with the `plan` template's developer-editable body (what `/prompt?node=plan`
   serializes as `prompt` today — the string the modal's textarea seeded). The developer
   edits it right there and sends; `run_node` carries `promptIsBody: true` and the engine
   appends the locked rules/contract/run-data suffix exactly as the modal path did. No
   preview box, no modal, no "Run with this prompt" — the keyboard is the input.
   - The `prompt_body` knob stays in the template editor for template authors.
   - **User rules** are the one affordance the composer does not replace: the `prompt_rules`
     knob persists across runs and was edited per node from the modal's rules editor. It
     remains editable in the template editor / node settings, not on the flow screen
     (flag in the PR).

b. **Plan refinement lives in a conversation.** After the first plan exists, the same
   composer becomes empty and conversational (§c contract). A "Refine plan" affordance on
   the plan panel focuses it (and selects the plan node when the user is elsewhere). No
   mode state: where you are + whether a plan exists decides what a send does.

c. **No Chat | Refine toggle.** Instead of the user declaring intent, the agent's **response
   schema** carries it: a follow-up response is `{ reply, plan? }`. `plan` present ⇒ the exact
   existing whole-plan refine pipeline runs (validate → new version → checklist sync →
   approval re-gates); `plan` absent ⇒ transcript reply only, node state untouched.
   Intent is one `undefined` check, deterministic and auditable — never inferred from prose.
   Branch-scoped refines stay deterministic too: their sends are `refine_plan` action calls
   (prompt = the prefilled scoped body), never conversation-classified.

d. **Every version is reviewable.** Whole-plan refinements get the same diff banner treatment
   branch refines already have (`diffBranchSteps` is already plan-agnostic), and every version
   tab is labelled with its provenance.

The safety property changes. Old: *"a plain chat message must never kick off a refinement run."*
New: *"a chat message changes the plan iff the response carries a plan payload"* — still not
for free, but auditable (`plan:` is literally in the parsed response) and bounded by explicit
apply policy (§3). Same trust model as interactive plan-mode tools. **Flag in the PR**:
`node-roles.ts:35`'s comment and `docs/pristine-plan.md:77` describe the old guarantee.

---

## 1. Follow-up response contract (`kinds/plan/schema.ts`)

```ts
/**
 * A plan conversation turn's response: always a reply, optionally a plan.
 * `plan` present ⇒ the engine applies it as a new version (§3); absent ⇒
 * reply only — node status, artifacts and checklist untouched.
 */
export const PlanFollowUp = z.object({
  reply: z.string().min(1),
  // .nullish(): an explicit "plan": null and an omitted "plan" mean the same (see below)
  plan: PlanResponse.nullish(), // PlanResponse = the whole-plan schema (schema.ts, §F1)
});
export type PlanFollowUp = z.infer<typeof PlanFollowUp>;
```

The parse pipeline — `parseFollowUp(raw: unknown): { reply: string; plan: PlanResponse | null }`,
pure and in a testable module:

1. Extract the JSON object from the response (same light pre-processing the plan contract
   parser already does — strip code fences etc.).
2. `PlanFollowUp.safeParse(obj)` succeeds → clean contract turn. `plan` present or absent is
   the turn kind; both are complete.
3. Wrapper failed but `PlanResponse.safeParse(obj)` succeeds → the model dropped the
   envelope: plan-only turn, reply defaults to `"Plan updated."`.
4. Neither parses → **reply-only with the raw text as the reply** (and a debug log). This is
   the freedom guard: free-form output is a conversational answer, NEVER a plan — wrong
   guesses can only cost a turn, not a version.

The empty-plan edge: `plan: null` (explicit) and `plan` omitted are the same — reply only.

## 2. Prompt template (`prompt-defaults.ts` — rewrite `plan_refine` in place)

Keep the **`plan_refine` key** (promptKeys, `check-prompt-splits.ts`, and
`verify-prompt-parity.ts` fixtures stay stable), but rewrite its body as the conversation
contract:

```
The conversation continues. The developer's latest message is:

"""
{{feedback}}
"""

{{context}}

Answer the developer. If — and only if — the message asks for a change to the plan itself,
ALSO return the updated plan. Return a single JSON object only (no prose, no code fences):

{
  "reply": "<what you did or answered, in plain text for the developer>",
  "plan": { "markdown": "...", "steps": [...], "branches": [...] }   // omit entirely when not changing the plan
}

Rules:
- omit "plan" for questions, critiques, status requests — do NOT echo the plan back unchanged
- when "plan" IS present it must be the COMPLETE plan response (the full schema, contract
  below) — untouched branches are returned byte-identical; reuse existing step ids so unchanged
  steps keep their identity
- the "Current checklist" in your context may include developer hand edits — treat them as
  intent and preserve them unless the message changes them
```

Variables: `feedback` (the message), `context` (the existing whole-plan context assembly —
the `edits` block default-On is exactly what the template's "preserve hand edits" rule needs;
`refinement-plan.md` context block registry, unchanged). The internal output-contract suffix
(`internalSuffix`/output directive block) stays appended — it carries the plan shape and the
JSON discipline; the template's own JSON hint mirrors it for the `reply` field.

The engine's **retry-on-contract-violation** path (§3) re-states the full contract in the
feedback turn — existing machinery (`PlanOutputContract.feedbackPrompt`), no change.

## 3. Engine — the follow-up run and the apply policy

### 3a. `PlanNode.chat()` — replace the inherited rerun-with-feedback recipe

`AgentRunNode.chat()` stays exactly as-is for every other node (build/review/resolve keep the
base recipe and the `chatInput()` mapping, `node-roles.test.ts` coverage unchanged). The plan
node overrides it. Behavior mirrors the scoped-refine implementation shape
(`plan-node.ts` `run()` scoped branch):

```
chat(ctx, content, model):
  agentId  = node.agent_id
             // null ⇒ start a fresh agent (same fallback AgentRunNode.converse uses today, §8)
  prompt   = assemblePrompt('plan_refine',
               { feedback: content, context: assemble(ctx, { feedback: content }) })
  raw      = one agent turn on the SAME session (followUpOn = agentId),
             with ONE bounded feedback retry on a contract violation
             (existing per-mode retry machinery, scoped-refine shape)
  followUp = parseFollowUp(raw)                      // §1 — never throws on reply-only
  if (followUp.plan == null)
    return followUp.reply        // node status, artifacts, checklist, current_node: UNTOUCHED
  applyPlanVersion(ctx, followUp.plan, { feedback: content })   // the §3b rule
  return followUp.reply
```

Notes:

- The plan-present apply **is** today's refine pipeline: `PlanStore` artifact version
  (`meta.feedback` rides, giving `MainPlanSection` the "Refined from feedback" echo),
  `syncFromPlan` checklist sync, lifecycle event, and whatever status resolution the
  whole-plan refine branch of `run()` does today. Only its *caller* moved from `runNode` to
  `chat()`.
- `model` continues to pass through as the per-run override — receiver unchanged
  (`AgentRunNode.chatInput` semantics).
- Run label for the feed: today a feedback run surfaces "plan refine". A follow-up records the
  same label on version-bearing turns and `"plan reply"` is implicit (no run section). Version
  tab labels (§6) carry the attribution.

### 3b. The apply policy — what guards the state machine

`applyPlanVersion` runs the same validation chain `run()` uses (`PlanResponse` parse +
schema refinements + normalize), then applies a small **state guard** before persisting:

```ts
private applyPlanVersion(
  ctx: FlowCtx, raw: unknown, input: { feedback: string },
): { applied: true } | { applied: false; reason: string } {
  const plan = PlanResponse.parse(raw);        // throws → §3c's bounded retry, never the node
  const node = this.node(ctx);
  if (APPLY_BLOCKED.has(node.status))          // see table
    return { applied: false, reason: `can't update the plan while it is ${node.status}` };
  // …the existing whole-plan persist path: saveArtifact version + meta,
  // syncFromPlan checklist sync, lifecycle event, status → awaiting_approval
  return { applied: true };
}
```

| Node state | `plan` in response | Behavior |
|---|---|---|
| `awaiting_approval` (the normal case) | yes | full apply: version bump, checklist sync, status stays `awaiting_approval` |
| `pending` (no plan yet — not reachable from the UI; the tab only opens after run 1) | yes | treat as the *first* apply: version 1, status → `awaiting_approval` |
| `running` | yes | reply answered, **version refused**; lifecycle event `plan update ignored — node running` (the composer lock makes this rare, but the contract must not corrupt state) |
| `failed` | yes | allowed — a rescue path: apply, status → `awaiting_approval` (what a `retry`-then-refine costs today, minus the detour) |
| `approved` / downstream building | yes | refused like `running` — the plan already gated build; re-planning happens only via an explicit flow-level action, never silently mid-build |

The refusal is **not** a throw: the developer still gets their conversational answer; only
the state change is declined, and the reply text says why — so a retry makes sense.

### 3c. Failure semantics for conversational refines (a deliberate divergence)

- Response contains a `plan` that fails `PlanResponse` refinement checks (duplicate ids,
  dependsOn resolution, branch membership): **one** bounded feedback retry on the same session
  (same machine as scoped refines).
- Still invalid after the retry: **no node `failed` status, no partial version** — the attempt
  ends as an assistant message:
  `I couldn't produce a valid plan for that — {first violation in plain words}. Try rephrasing
  or being more specific; nothing was changed.`
  plus one lifecycle event. The user can immediately reply — same session — which a
  `node failed → retry → retype` rollercoaster would have lost.
- Reply-only responses skip contract machinery entirely (a missing `plan` IS the valid path).

### 3d. `sendChat` / engine dispatch — zero-change goal

`flowEngine.sendChat` (`flow-engine.ts:1750`) routes via `nodeRoles.chatRefinerOf(def)` —
already correct, and its `chatOnly` parameter plus `Converser.converse()` remain for the other
nodes (build/review conversation mode unaffected). **The plan node drops
`chatOnlyMode: 'refine'` from `capabilities`** (see §5). With that gone, the UI stops sending
`chatOnly` for the plan node and the follow-up contract becomes the only path a plan-node chat
message can take. Everything new lives inside `PlanNode` (`chat()` override +
`applyPlanVersion` + `parseFollowUp` helpers); `flowEngine.sendChat` keeps its public
signature and needs no change.

## 4. UI — the composer is the plan's only input

Design decisions a–d collapse every plan input onto the chat composer. The switch among the
three composer states rides one new capability — `chatMode: 'plan'` on the plan def
(`chatOnlyMode` is removed; see §5), serialized to the client through the existing
`NodeUiCapabilities` projection — plus the cockpit's existing state:

```
planPending = capabilities?.chatMode === 'plan'
           && node.artifacts.length === 0
           && node.status === FLOW_STATUS.PENDING    // today's promptPending shape, rebuilt on chatMode
```

### 4a. Prompt state — no plan yet (pre-first-run)

- The composer's draft is initialized from `/prompt?node=plan` — the same body fetch
  `NodePromptBox` used (`useNodePrompt`, unchanged). Loading = a small skeleton line inside
  the composer; failure = inline retry (§2.8 states preserved — never an empty disabled box).
- The textarea **auto-grows** (up to ~40vh scrollable — real prompt bodies are hundreds of
  lines; the modal used to be the only comfortable editor for them, so this affordance
  matters). Small char count at the input's edge (NodePromptBox's affordance, reduced to a
  caption).
- A ghost `Reset to template` control appears only when the draft diverges from the fetched
  body (the modal's `canReset` affordance, reduced).
- Send button label: `Generate plan`. Path: the existing `startNode` — `run_node` with
  `{ prompt: draft, promptIsBody: true, decompose, model }` (`FlowCockpit.tsx:110-125`).
  send action branch lives in a new feature hook (below), so `use-chat-composer` never grows
  plan logic.
- `PlanOptionToggles` (decompose) stays beside the model selector in this state only.
- On accepted send: draft clears (existing `send` behavior), and the composer flips to
  conversational state once the artifact lands.

### 4b. Conversation state — plans exist (the §c contract surface)

- Empty draft, placeholder `Refine the plan or ask anything — the agent decides what to
  update`; send = `POST /chat` (`chatOnly: false`), whose response parsing is §3.
- Heading label `Implementation plan` instead of the generic `… agent` — the *tab* is the
  node's own chat feed, and no new transcript store: the plan conversation IS the plan node's
  messages (`useFlowChatMessages`). A "second refine session" is an agent-session property
  plus version labels (§6), never a separate tab.
- This is the state the plan panel's `Refine plan` button focuses (§4d).

### 4c. Scoped prefill state — branch refine (deterministic, NOT contract-classified)

- The branch card's `Refine` button enters scoped-prefill mode on the composer: fetch
  `/prompt?node=plan&branch=<name>` and prefill the draft with the seeded
  `plan_subplan_refine` body. The developer edits the `{{feedback}}` section in place and
  sends.
- A **caption chip above the input**: `scoped refine: <branch> · ✕` — cancels back to
  conversation state (clears the branch ref and the prefilled draft).
- Send path: the `refine_plan` **action** with `{ prompt, promptIsBody: true, branchRef,
  fresh: true }` — unchanged from today's modal run, minus the modal. No LLM intent on
  branch refines by construction (§c).
- If the ref'd branch no longer exists in the latest plan (another refine landed first), the
  prefill fetch fails → chip shows invalidated with a retry; sending stays disabled.
- The engine's locked scoped suffix (branch contract + plan_subplan_refine rules) is
  appended at run time (`promptIsBody` + branchRef), exactly as the modal path did.

### 4d. Mechanical wiring — a `ComposerConfig` seam, not plan forks in `ChatPanel`

`ChatPanel` stays a generic shared component (AGENTS §2.4). The three states are expressed as
a config prop `composer?: ComposerConfig` that the plan wiring builds; other nodes pass
nothing and get today's behavior:

```tsx
export interface ComposerConfig {
  /** null = conversation state (empty draft); string = prefilled prompt/branch body */
  draft: string | null;
  loading: boolean;            // prefill fetch in flight → composer skeleton
  error: React.ReactNode | null; // prefill failure + retry slot
  sendLabel: string;           // "Generate plan" | "Send"
  growing: boolean;            // auto-grow tall textarea (prompt/scoped states)
  caption?: React.ReactNode | null; // scoped chip slot / plan-context hints
  reset?: { canReset: boolean; onReset: () => void };
  onSend: (draft: string) => void;  // run_node | chat | refine_plan — decided here
  placeholder: string;
}
```

- **`components/flows/plan/hooks/use-plan-composer.ts`** (new, feature-local): owns the state
  machine (prompt → conversation → scoped-prefill), the two fetches (`useNodePrompt` today,
  the branch body), the draft, and the three `onSend` targets. It composes
  `useChatComposer`'s draft/sending mechanics or replaces them — its call.
- `ChatComposerForm` gains the `caption` + `growing` slots (`InputGroupTextarea` wraps in a
  ScrollArea when growing — no new CSS file, Tailwind only) and loses the refine toggle.
- `ChatPanel` renders `<ComposerConfig>` over its standard feed when provided; the refine
  toggle, `refineOn`, and `toggleRefine` props are deleted from `ChatComposerForm` +
  `use-chat-composer` in the same phase (contract already live, §9 dependency).
- `NodePromptBox` is deleted in this phase — its resume affordances (preview, session,
  settings, reset, generate label) all move into the composer states; ChatPanel's
  `showPromptBox`/`promptEditing`/`useNodePrompt` blocks go away.
- `PlanPromptModals` is deleted — the whole-plan modal entry (`runWithPrompt`, the hardcoded
  `feedback: ""`) and the branch modal entry both replaced by §4a/§4c. The plan panel keeps
  its `Refine plan` header button, which focuses the composer (via a small
  `focusChat: { key; at }` callback threaded through `NodePanel`'s `PanelProps` →
  `PlanPanelHeader`, consumed by the composer's focus effect). First-run state doesn't exist
  as an early flow description: before the first plan the composer IS in prompt state — no
  separate button copy for it.
- **Scope guard:** the modal concept survives for review/resolve/pipeline in this round
  (`ReviewView`, `ResolveView`, `PipelineView` keep `PromptModal` + `use-flow-prompt`) —
  migrating them is the "later extensions" row (§9). Everything the plan path stops using
  that those views don't use (ContextPicker, the contextBlocks payload/params, the plan
  branch prefill) is deleted; everything they still use stays.

## 5. Deletions

| # | Item | Where |
|---|---|---|
| 1 | refine toggle (state, JSX, aria/icons) | `ChatComposerForm.tsx:99-142`, `use-chat-composer.ts:33-41,80-83` |
| 2 | `chatOnlyMode: 'refine'` on the plan def + its UI projection (`chatMode` replaces it) | `plan-node.ts:60`, `nodes/shared/capabilities.ts`, `types/node-capabilities.ts` |
| 3 | whole-plan Edit-prompt modal path + `runWithPrompt` + the hardcoded `feedback: ""` rerun | `PlanView.tsx:46-47,86-99`, `PlanPromptModals.tsx:36-47` |
| 4 | branch-refine **modal** entry (replaced by the §4c composer prefill; the `refine_plan` action stays) | `PlanPromptModals.tsx:49-64`, branch-modal props in `PlanView.tsx` |
| 5 | `NodePromptBox` + ChatPanel's `showPromptBox`/`promptEditing`/`useNodePrompt` block (replaced by §4a composer prompt state) | `components/chat/NodePromptBox.tsx`, `ChatPanel.tsx:80-89,102-117,165-176` |
| 6 | `PromptModal.feedback` prop + `useFlowPrompt.feedback` + `?feedback=` preview param | `PromptModal.tsx:33,45,78`, `use-flow-prompt.ts:79,96,114`, `prompt-preview.ts:72` |
| 7 | `previewPrompt`'s feedback→`plan_refine` branch (unreachable after #6) | `plan-node.ts:222-237` — the fallback remains: without `feedback`, the preview serves the `plan` template |
| 8 | plan node's `converse` path (only reachable via `chatOnly`, which plan never sends after #2) | no code change needed — `Converser` machinery stays for other nodes |
| 9 | `ContextPicker` + the contextBlocks payload/`?contextBlocks=` param (only the plan branch modal passed `showContextPicker`) | `components/chat/prompt-modal/ContextPicker.tsx`, `PromptModal` props, `prompt-preview.ts:75,52` |

Kept deliberately (NOT dead): `PromptModal` + `components/chat/prompt-modal/` minus
`ContextPicker` (review/resolve/pipeline still use it, scope guard §4d); the
`plan_subplan_refine` body fetch route (`?branch=` — now feeds the composer prefill);
`plan_subplan_refine` template + `PlanInput.contextBlocks` (engine default `[]` applies —
selection UI is gone, assembly defaults are not); `use-flow-prompt`'s non-feedback parts;
the `plan_refine` template key (re-aimed in §2); `AgentRunNode.chatInput()` (base recipe —
other nodes); `CHAT_DECLINED`; the `refine_plan` action (branch refines §4c); the `edits`
context block (whole-plan refine context, default-on, no UI involved).

## 6. Review layer — diff banner + version labels

No server changes — everything client-side from `plan-meta` (the §1 scopeless outputs already
persist `feedback` in meta; the version set is version-ordered).

### 6a. Whole-plan diff banner

Extend `components/flows/plan/branch-diff.ts` — the step machinery (`DiffStep`,
`diffBranchSteps`) is already branch-agnostic; a whole-plan diff is the same comparator over
ALL steps instead of one branch's:

- new `pickWholeSteps(meta)` — identical mapping to `pickBranchSteps`, without the
  `s.branch === branch` filter (keep each step's `branch` on the record so rows can be
  annotated `branch: auth`).
- new `computeWholePlanDiff(plans: Artifact[]): WholePlanDiff | null` — fires only when the
  latest version carries a refine provenance mark (`meta.refinedFrom`, §6c; `meta.feedback`
  alone covers toggle-era versions) and returns the diff between the latest version and the
  immediately-previous one. No `scopedRefine` record needed; `from` = `latest.version - 1`.
- the banner renders above the newest version in `PlanView`, reusing the branch banner's
  component: `v4 — 2 steps changed, 1 added, 1 removed (branch: auth)` with the expandable
  old-vs-new rows.

This closes exactly the drift risk `branch-scoped-refine.md` documents for whole-plan
re-emits — for conversational refines it is the primary trust signal, since a version can now
appear from one sentence of feedback.

### 6b. Version tab labels

`VersionTabs` (`components/flows/panels/shared.tsx`) gains an optional
`captions?: Map<string /* artifactId */, string>` prop; `PlanView` builds it from each
artifact's meta: feedback echo (truncated ~40 chars, quoted), `"branch refine: auth"` when
`meta.scopedRefine?.branch`, `"refined in chat"` when `meta.refinedFrom.source === "chat"`
with no feedback recorded, else plain `v{n}`. The diff banner stays the detailed view; the
label is the glanceable summary.

### 6c. Refine provenance in plan-meta (small engine addition)

Plan artifact meta already records `feedback` on chat-refine versions. The diff banner and
tab labels need one more meta field to distinguish *who* produced a whole-plan version:

```ts
// PlanStore's whole-plan version persist — meta gains:
refinedFrom: { version: prevVersion, source: "chat" | "branch" | "start" }
```

- `source` is decided at the apply site: a conversational apply (§3a) writes `"chat"`, the
  scoped branch refine writes `"branch"` (its merge already persists `scopedRefine` — this
  field is the sibling record), the first plan writes nothing.
- Stored **only** on version-bump-producing runs — never on reply-only turns, so "a version
  with `refinedFrom`" and "a produced refine" are the same set.

## 7. Concurrency & status interplay

Everything here is covered by existing machinery plus the §3b guard; listed explicitly for the
implementer:

- **Reply-only turns** never touch node status, artifacts, `current_node`, or the checklist —
  the same contract `AgentRunNode.converse()` already keeps. The flow's event stream shows
  only the transcript messages.
- **Plan-bearing turns** run the whole-plan persist path inside `chat()`. The composer's
  `sending` state (client) plus `busy` (flow `current_node`) serialize the session; a second
  message sent while the first is mid-run server-side lands on the §3b
  `running` refusal — answered, no mutation.
- **`current_node`** stays owned by the engine exactly as today: `sendChat` sets it, the run
  clears it. A version-bearing follow-up holds it for the apply's duration, same as a
  refine action run does — meaning the graph/panel busy indicators behave identically to
  today's chat refine.

## 8. Edge cases

- **No agent on a follow-up turn** (scoped refines can be this way too): `agentId ?? null`
  falls back to starting a fresh agent — the same guard `AgentRunNode.converse()` already
  documents ("run the step first, or switch on refine mode"). The turn still works; it is just
  ungrounded-but-contracted.
- **Agent replies with plan AND prose**: the envelope carries both — `reply` goes to the feed,
  the plan takes the apply path. Nothing special; §3a's return order is already reply-posted,
  apply-visible.
- **`reply` missing, plan present** (model elides the envelope): §1 normalization step 2
  applies — plan wins, default reply text `"Plan updated."`.
- **Plan rejected by §3b while the user also asked a question**: the refusal reply answers
  *and* explains why the update was skipped — never a silent dead end.
- **Running node + a message that slips through** (the feed is scrollable while the composer
  is locked): §3b table — refuse in plain language; never mutate `current_node`.
- **Multi-message bursts**: the composer's `sending` guard serializes the client side; a
  second message racing the first server-side hits the `running` refusal — safe and visible.
- **Hand edits vs. whole-plan re-emits** (`edits` context block default-on): a whole-plan
  re-emit may still drop untold steps — the same risk scoped refines solve at the source with
  live-rows input. The §6 banner makes it visible; the deeper mitigation (id-preserving
  whole-plan merge, a `mergeWholeRefine` mirroring `mergeBranchRefine`) is an optional later
  extension, not v1.
- **Quality escape hatch ("fresh agent")**: a conversational follow-up is session-bound by
  definition. v1's levers are the per-message model selector and "just ask" for grounding;
  if whole-plan turns later need re-grounding, add a "New agent" checkbox to the composer
  footer (semantics: `followUpOn = null`, prompt carries everything the model sees — the §1
  contract is unaffected; the scoped-refine modal's checkbox is the shape to copy).
- **Prompt-state specifics (§4a)** — prefill fetch fails → inline retry, send disabled (never
  an empty draft the user could send by accident); the user clears the whole draft → send
  disabled (a silently-empty prompt is worse than none); the run starts while the draft
  differs from the template body → meta gains `refinedFrom.source: "start"` with the body
  recorded in the run input (audit unchanged, `prompt-preview` last-run overlay still
  truthful for the eventual other-node modals).
- **Scoped-chip staleness (§4c)** — the ref'd branch vanishes from the latest plan before the
  user sends (another refine/version landed) → the send's `refine_plan` call fails cleanly
  (`app/api/…/action` 400) and the chip shows invalidated with a cancel/retry; the composer
  never silently reroutes a scoped send to a whole-plan one.
- **Composer height**: prompt-state bodies can be long; the growing textarea is capped and
  scrolls — the send affordance and the toggles must stay visible in both states (layout
  test, not just visual).

## 9. Sequencing & risk

**Hard dependency:** the Chat | Refine toggle is removed only once every plan-message path
sits behind the structured contract. The interim state "toggle gone, contract not yet live"
would make every plain message a whole-plan refine (base-recipe behavior) with no escape —
so Phase 1 must land before Phase 2.

| Phase | Scope | Risk |
|---|---|---|
| **1 — contract** | `PlanFollowUp` + `parseFollowUp` (§1), `plan_refine` body rewrite (§2), `PlanNode.chat()` override + `applyPlanVersion` + failure semantics (§3a–c), meta `refinedFrom` (§6c). The old toggle still routes to the same `chat()` — both turn kinds are now contract-driven, behavior-compatible either way | Med |
| **2 — composer swap** | `chatMode: 'plan'` capability; `ComposerConfig` seam + `use-plan-composer` (§4d); §5 deletions 1–9 (toggle, `chatOnlyMode`, `NodePromptBox`, both modal entries, `PromptModal.feedback`/preview branch, `ContextPicker`); §4a–c states; `focusChat` wiring | Med |
| **3 — review layer** | §6a `computeWholePlanDiff` + banner component reuse, §6b `VersionTabs` captions | Low |
| later | whole-plan id-preserving merge (`mergeWholeRefine`, §8), review/resolve/pipeline migrate off `PromptModal` onto the same `ComposerConfig` seam (§4d scope guard), branch tabs → conversation, "New agent" checkbox (§8) | — |

## Tests

- **`plan-followup.test.ts`** (new) — the §1 parse matrix: full envelope; envelope with
  `plan: null`; plan-only fallback; plain-text fallback (reply-only, no accidental plan);
  envelope missing `reply`; garbage response.
- **`plan-node.test.ts`** — chat-via-contract cases: reply-only turn asserts no new run row,
  no artifact, unchanged node status (rows, not UI); plan turn asserts one new artifact
  version, `meta.feedback` + `meta.refinedFrom.source === 'chat'`, checklist sync; invalid
  plan → exactly one feedback retry → plain assistant refusal, node not `failed`;
  `running`/`approved` refusal per §3b.
- **`plan-prompt.test.ts`** — the rewritten `plan_refine` assembly (`feedback`, `context`
  blocks, user rules still appended).
- **Composer & cockpit** — existing `components/chat` harness tests refreshed for the toggle +
  `NodePromptBox` deletion; the three composer states (prompt: prefill/reset/generate label,
  conversation placeholder, scoped chip) render with loading/error/empty states covered.
- Unchanged: `node-roles.test.ts` (base recipe for the other nodes keeps its coverage) and the
  review/resolve/pipeline modal suites (they keep `PromptModal` this round).

Script checks: `npx tsx scripts/check-plan-followup.ts` (new, modeled after
`scripts/check-branch-refine.ts`): template composition, the parse matrix above, meta
provenance expectations. `check-prompt-splits.ts` keeps its `plan_refine` entry (body only
changed — split definitions likely still valid; bump if the contract shape moves text across
the split boundary).

## AGENTS.md process notes

- **Flagged behavior change** in the PR description: the "a plain chat message must never kick
  off a refinement run" guarantee (design decision c) is replaced by the structured-contract
  apply policy — `node-roles.ts:35` comment updated in the same phase, plus
  `docs/pristine-plan.md:77` and `docs/prompt-flow-inconsistencies.md`'s plan row.
- Diffs stay focused — three phases → three PRs; no `components/ui/` changes, no new
  dependencies, runtime stays Node (`better-sqlite3` unaffected).

## Definition of done

- [ ] `npm run build` and `npm run lint` green for every phase
- [ ] `npm test` — the new/updated suites above pass; `verify-prompt-parity.ts` still resolves
      (input fixture `feedback` stays — the chat path still carries it)
- [ ] every chat/feed surface keeps its loading / error-with-retry / empty states (existing
      `useChatFeed`; the banner adds no new fetch)
- [ ] grep-clean: no leftover `refineOn` / `chatOnlyMode: 'refine'` / `PromptModal.feedback`
      / `NodePromptBox` / `PlanPromptModals` / `ContextPicker` references, and
      `ChatComposerForm` has no `PencilIcon`/`WrenchIcon` imports
- [ ] review/resolve/pipeline unchanged this round: their modals still open, run, and keep
      rules editing (scope guard regression check)
- [ ] demo walkthroughs (Try it) manual-checked on `npm run dev` before merge

## Try it

- Phase 1 on: `npm run seed:demo` — after generation, plain questions in the plan chat land
  as reply-only; "move step 2…" comes back with a version (+ banner in Phase 3).
  `npm run seed:branch-refine` → DEMO-207 stays unaffected.
- Phase 2 on: no prompt box, no modal anywhere on the plan node — a fresh flow's composer
  opens prefilled with the plan prompt (edit it, Generate); after it lands the composer is
  empty and conversational; "Refine plan" on the plan panel jumps here; a branch card's
  `Refine` prefills the scoped body with a `scoped refine: <branch>` chip.
- Phase 3 on: a whole-plan chat refine shows the changed/added/removed banner; version tabs
  carry provenance captions.
