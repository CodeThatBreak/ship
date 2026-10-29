# Prompt Flow — Inconsistencies Audit (Oct 2026)

What "prompt in a flow" is supposed to be, what actually happens per node type,
and a catalog of inconsistencies with file/line evidence. Based on the belt of
code active today: built-in SDLC nodes (plan, build, review, resolve, pipeline
gate) plus declarative agent nodes.

---

## 1. The intended model (recap)

One assembly path should own everything (`lib/engine/prompts.ts`,
`assemblePrompt` 122–139):

```
final prompt  =  body  →  userRules  →  internal blocks (engine rules / contract / run data)
   (user/template)  (prompt_rules knob)      (locked, engine-authored)
```

Prompt body sources, intended precedence (highest first):

1. **Per-run modal edit** — carried through the action as `prompt`, plus
   `promptIsBody` (`edit the body only, re-append internal blocks` vs `send verbatim`).
2. **Config knob** — `prompt_body` / `fix_prompt_body` on the node's config.
3. **Built-in default** — `userTemplate` in `lib/engine/prompt-defaults.ts`.

In practice there are **five state layers** that can each "win" in different
code paths:

| # | Layer | Where it lives | Who writes it |
|---|-------|----------------|---------------|
| A | Per-run modal edit | request body `prompt` + `promptIsBody` on `POST /api/flows/:id/action` | the PromptModal ("Run with this prompt") |
| B | Per-run snapshot | `nodes.prompt_override` column (`rows.ts:133`) | `execute()` at every run (`node-definition.ts:251, 273`) |
| C | Flow-instance config snapshot | `nodes.config` JSON (baked at flow creation) | `flow.ts` create/createStepChild |
| D | Template config | `node_templates.config` / `flow_template_nodes.config` + the template editor's Prompt tab | template editor / YAML |
| E | App settings layer | `settings["node_config.<defKey>"]` | settings page |

The nodes table never re-merges D at run time — C is the only snapshot the
running node sees — and the prompt preview route (`app/api/flows/[id]/prompt/route.ts:15–17`)
only merges **E + C**, then gives **B absolute veto** (82–95).

---

## 2. Plain-language answer: what issue did we find?

Three interlocking problems, all pointing at the same DX hole:

### Issue 1 — The flow window never shows the prompt that is actually executing

- The pre-run prompt box over the chat (`ChatPanel`/`NodePromptBox`) is gated on
  `capabilities.promptNode`, and **only the plan node sets it**
  (`plan-node.ts:268`, `capabilities.ts:82`; `FlowCockpit.tsx:72–78`). Build,
  review, resolve and pipeline have no visible prompt surface pre-run — only
  small "Edit prompt" buttons inside their panels, and `BuildView` has none at all.
- **While a node is running, nothing anywhere shows the final prompt.**
  `AgentView.tsx:83` explicitly hides the prompt card while running; the
  built-in panels just render a spinner. The executed prompt only exists in
  `nodes.input.prompt` / the agent port payloads, which no view renders.
- The declarative agent panel shows the prompt only as the **raw, un-rendered**
  `nodes.config.prompt` with `{{…}}` intact (`AgentView.tsx:88–90`) — not what
  the agent receives.

### Issue 2 — After the first custom-prompt run, `prompt_override` hijacks the preview forever

`prompt_override` is **written on every run** (the body or verbatim text that
*entered* the run) and **never cleared or invalidated**. The preview route then
gives it an absolute veto, verbatim, `appendsInternal: false`
(`route.ts:82–95`):

- After run 1 with a modal-edited prompt, the flow window shows the **stale
  body** from run 1 — *without* the engine blocks that were re-attached before
  the agent actually received it (review does append them at run time,
  `review-node.ts:90–96`), so preview ≠ what ran.
- Any later edit to the template or the `prompt_body` config knob **stops
  appearing** in the flow window — which is exactly the "prompt defined in
  template config is not shown" symptom.
- The *next* run resolves fresh (knob → default; `prompt_override` is never read
  as input at run time), so displayed prompt ≠ next prompt sent. Preview lies
  in both directions.

### Issue 3 — Template-config prompt edits don't reach flows that already exist

A flow node's config is a **baked snapshot at flow creation** (`flow.ts:121–136`,
inline `mergeConfigLayers`; `bakeNodeConfig` at `node-config.ts:116–127` exists
but has zero callers). `effectiveConfig` in the preview route merges only the
app-settings layer + that snapshot — never the live `node_templates.config`.
So: edit the prompt in the template config → existing flow keeps showing (and
running) the old body. Only new flows pick the change up. There is also no
`set_node_config` path for built-in prompt knobs from the flow window (review /
resolve / pipeline rules saving via `rulesKey` writes instance config, but body
saving is not wired uniformly).

---

## 3. Catalog of inconsistencies

Severity: 🔴 user-visible/wrong text reaches agent or preview lies badly ·
🟠 preview/UX drift · 🟡 code-level debt that invites future drift.

| # | Sev | Title | Evidence |
|---|-----|-------|----------|
| 1 | 🔴 | Flow window shows no prompt while a node runs (see Issue 1) | `FlowCockpit.tsx:72–78`, `plan-node.ts:268`, `AgentView.tsx:83` |
| 2 | 🔴 | Stale `prompt_override` wins the preview forever, beats template/config edits, and misrepresents both what ran and what will run (see Issue 2) | `route.ts:82–95`, `node-definition.ts:251,273` |
| 3 | 🔴 | `prompt_body` means different things per node: build = **verbatim override** (the run's plan/instructions/checklist are dropped entirely, `prompts.resolve` override slot at `build-node.ts:210–215`); review/resolve/pipeline = **body replacement** with engine blocks re-appended (`review-node.ts:90–96`, `pipeline-node.ts:296–301`, `plan-node.ts:531` same pattern). The build field's help text ("User-editable prompt body for build runs") does not warn that it *replaces the whole prompt including the plan*. | `build-node.ts:55,157–161,210–215` |
| 4 | 🔴 | Two incompatible variable grammars. Built-ins render only `\{\{(\w+)\}\}` (`prompts.ts:87–89`): a dotted ref like `{{task.key}}` typed into a plan/build/review body is sent **literally** to the agent. Declarative `agent` nodes use the dotted-path renderer (`agent-node.ts:28–44`) where an unknown *flat* key silently renders to `""`. Same syntax, two universes, zero shared validation. | `prompts.ts:87–89` vs `agent-node.ts:28–44` |
| 5 | 🔴 | Preview vs run for the **pipeline gate** are glaringly different: the preview switch never fills `ctxVars` for pipeline (`route.ts:135–140`), so the rules block renders as `CI/CD pipeline # failed on branch .` (empty `{{pipelineId}}`, `{{branch}}`, `{{logs}}`). The run fills them (`pipeline-node.ts:555–575`). | `route.ts:135–140` |
| 6 | 🟠 | Preview vs run for **build**: the route (`route.ts:126–128`) hand-rolls *different* instructions text than the run (`build-node.ts:188–190` — "create and check out a new git branch…" vs "your working directory is a git worktree already checked out…"), and never includes `{{checklist}}` even though the run does (`build-node.ts:196–208,212`). The modal "final" therefore differs from the run byte-for-byte. | `route.ts:121–134` vs `build-node.ts:188–215` |
| 7 | 🟠 | Blank-line whitespace: review, resolve and pipeline fix **collapse blank lines** before sending (`.split("\n").filter(Boolean).join("\n")`, `review-node.ts:96`, `resolve-node.ts:108`, `pipeline-node.ts:573–575`); plan and build don't. The preview keeps blank lines, so even with identical variables the modal's `final` ≠ the text sent for exactly the three nodes where the collapse happens. |
| 8 | 🟠 | The variables chip list in the modal/template editor doesn't match reality: `build` advertises `branch`, `mode` which the user body never uses (`prompt-defaults.ts:243`); `plan_complex` advertises scope/files/dependsOn/subPlanPrompt which only exist in the internal plan JSON contract (`prompt-defaults.ts:226`); review advertises `diff` as a chip although it's engine-run-data, not user-fillable (`prompt-defaults.ts:355`). |
| 9 | 🟠 | Unknown `{{var}}` behavior differs by family: built-in renderer → placeholder silently `""` if not supplied by the *def* (e.g. `{{ticket_summary}}` in a build body renders empty; also a **typo deletes the sentence silently**); declarative dotted renderer → unknown flat key `""`, unknown dotted path literal passthrough (see `agent-node.ts:28–44`). No lint on user-authored bodies (the context linter covers declarative templates only, `context-lint.ts:82,303–306`). |
| 10 | 🟠 | Declarative agent nodes can't use the PromptModal at all: the prompt route rejects unknown keys (`route.ts:65–66`) and `AgentTemplateNode` sets no `promptNode` capability. Its "Configure" dialog edits `nodes.config.prompt` directly. So the two surfaces — three-part modal for built-ins, free textarea for agent nodes — never converge. |
| 11 | 🟠 | `step_build` **omits `userRules`** (`step-build-node.ts:117–122` passes no `{ userRules }`), while every other agent-running node honors the `prompt_rules` knob. Fan-out step children silently ignore standing rules. |
| 12 | 🟠 | `nodes.input.prompt` has two meanings: built-ins persist the **final assembled** prompt (`build-node.ts:218`, `review-node.ts:99`), agent templates persist the **raw body** (`agent-node.ts:189`). `StartView` already has to defensively `delete recorded.prompt` (line 168) so the final prompt doesn't leak into a start form — proof the ambiguity bites. |
| 13 | 🟡 | The three-part prompt for a node can be read **unrendered** (`templateParts`, used by the template editor Prompt tab) or **rendered** (modal). The template editor shows `{{vars}}` intact; the modal shows one run's values. Same data, different projections, no label says which is which. |
| 14 | 🟡 | `bakeNodeConfig` (`node-config.ts:116–127`) is defined but never called — flow creation inlines an equivalent merge (`flow.ts:125,203`). Dead abstraction that has already drifted conceptually. |
| 15 | 🟡 | Pipeline special-casing encoded in 3 places: `PIPELINE → pipeline_fix` remap (`route.ts:64`), knob-name switch `fix_prompt_body` / `fix_prompt_rules` (`route.ts:136,166`), and template-editor logic (`config-field-logic.ts:29–46`). Any new gated node will need three more edits. |

---

## 4. Node-by-node status matrix (what today actually is)

| Node | Body knob | Rules honored | Where the body comes from at run time | Flow window pre-run | Flow window while running | Preview route filled vars |
|------|-----------|---------------|----------------------------------------|---------------------|---------------------------|---------------------------|
| plan | `prompt_body` | ✅ | input.prompt (body mode) → knob → default template | prompt box ✅ (only node) | spinner only | ticket, ticket_type (+feedback refine), context pkg. NOTE: plan chat no longer blindly reruns with the message as feedback — it is the follow-up contract (`{reply, plan?}`, provenance per docs/plan-conversation-refine.md §3b/§6c: chat refines mark `refinedFrom.source: "chat"`, prompt-body reruns diverging from the template mark `"start"`). |
| build | `prompt_body` **(verbatim override!)** | ✅ | input.prompt (verbatim) → knob → default template | ❌ no box or button | spinner only | ticket, branch, mode; instructions **paraphrased**, no checklist |
| review | `prompt_body` | ✅ | input.prompt (body mode) → knob → default | "Edit prompt" button (modal) | spinner only | ticket_*, instructions; diff stub |
| resolve | `prompt_body` | ✅ | input.prompt (body mode) → knob → default | "Edit prompt" button | spinner only | dev/instructions; comments/header/subheader stub |
| pipeline | `fix_prompt_body` | ✅ (fix runs) | input.prompt (body mode) → knob → default | "Edit prompt" button (pending) | spinner only | guidance + mode instructions only — branch/pipelineId/logs empty |
| step_build | — | ❌ silently ignored | default `step_build` template (or modal verbatim) | ❌ | spinner only | n/a |
| agent (declarative) | `nodes.config.prompt` (separate editor) | n/a | `cfg.prompt` → dotted render at run | raw `{{…}}` text in AgentView | hidden entirely | no modal, no route |

---

## 5. Recommended fix directions (prioritized)

1. **Show the real prompt while running.** The engine already records it
   (`nodes.input.prompt` / prompt payload via `execute()`). Surface it in the
   running panel (e.g. a collapsible "Executing prompt" card in the cockpit
   panels) and calendar the same source for agent-mode. This alone fixes the
   core "prompt not shown while running" complaint.
2. **Fix `prompt_body` semantics for build** — fold the knob in as a *body*
   (with the internal run data appended) like plan/review/resolve, or rename it
   `prompt_override` and warn in help text that it discards plan/instructions.
3. **Tame `prompt_override`:** clear it on every new run start when the modal
   wasn't used (or recompute), and make the preview route label it honestly
   ("verbatim, from run N") instead of presenting it as the configured prompt.
4. **Re-merge the live template layer** into `effectiveConfig` (template →
   instance → app layer) so template-config prompt edits reach existing flows.
5. **One variable grammar.** Support dotted paths in `PromptLibrary.render`
   (or validate built-in bodies against the flat universe with a lint error
   surfaced in the modal), and mark unknown vars at save time instead of
   silently rendering `""` or sending literals to agents.
6. **Fill pipeline/design promised vars in previews** (branch, pipelineId,
   checklist) or explicitly hide sections whose vars are unfilled at preview
   time; stop the whitespace divergence by fixing it in `assemblePrompt`.
7. Give `step_build` the `userRules` treatment, and make the modal's variable
   chips match each template's *actual* placeholder universe.
