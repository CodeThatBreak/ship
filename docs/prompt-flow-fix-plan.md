# Prompt Flow — Implementation Plan

Implementation plan for the inconsistencies cataloged in
[`docs/prompt-flow-inconsistencies.md`](./prompt-flow-inconsistencies.md). Issue
IDs below (I1…I15) refer to that doc's severity table.

Stack targets from AGENTS.md: Next.js 15 App Router (Server Components by
default), React 19, TanStack Query, TS strict, class-based services in `lib/`
(one class per file, kebab-case), registries over `switch`, Zod at boundaries,
Node runtime for better-sqlite3.

---

## 0. Goals and non-goals

**Goal:** one truthful prompt lifecycle — the flow window, the prompt modal and
the agent all show/exchange the *same final prompt*, sourced from the intended
layer precedence (modal edit → config knob → template config → default), with
one variable grammar and no silent drops.

**Non-goals (explicitly out of scope):**
- No new prompt-editing UX paradigms (no visual prompt builder).
- No `schema.sql` changes: `nodes.input` becomes the single prompt record; the
  `prompt_override` column (a runtime `ALTER TABLE` migration, not schema.sql)
  is demoted to unused and dropped in a follow-up (D1, §2 1.1).
- Global `prompt_templates` settings overlay stays removed (per `prompts.ts:63`).
- Root-run machinery untouched — fixing prompt consistency within the SDLC engine and declarative agent node as they exist. Also the Agents.md-mandated Zod validation of the action route body is adjacent debt (it currently trusts a cast, `action/route.ts:13`), but is not this task.
- No test runner or new dev dependency is added (D5): verification is the parity
  script + manual matrix in §9; the missing unit tests are flagged in the PR.

---

## 1. Design decisions (to be confirmed before Phase 1 lands)

| # | Decision | Recommendation | Alternative |
|---|----------|----------------|-------------|
| D1 | What `prompt_override` means | **(B) History + hint, column demoted:** the per-run record is `nodes.input.prompt` — the exact final prompt every run sent (normalized across all node kinds). The preview route never lets the column veto the live resolution; it returns both `current` (live layers) and `lastRun` (read from `nodes.input.prompt`) plus a `diverges` flag, and the modal renders the last-run text as a read-only collapsible ("what run N sent"). | Keep writing a separate `prompt_override` column too — verified redundant: its only reader is the route veto we are removing, and retry already runs from `nodes.input` (`flow.ts:1458`), not the column. |
| D2 | Build `prompt_body` semantics (I3) | **Body semantics** (like plan/review/resolve), which requires restructuring the `build` default template: move the run-time plan/instructions/checklist out of `userTemplate` interpolation into engine-authored `data` blocks, so a body replacement can't silently drop the plan. help text on `build-node.ts:55` updated to match. | Keep verbatim semantics but rename the knob `prompt_override` and document loudly that it replaces the entire prompt. |
| D3 | Template-config freshness (I1 issue 3) | **Read-time merge with explicit sync:** `effectiveConfig` becomes `mergeConfigLayers(appLayer, liveTemplateConfig, instanceLayer)`, where `instanceLayer` is *only instance-authored edits*. To keep that unambiguous without a schema change, `set_node_config`-written keys are tracked in a namespaced sub-key of the node snapshot (`config["#instance"] = {...}`) for new writes; existing snapshots keep behaving as the instance layer (no migration). Template save additionally triggers a re-bake of snapshots for flows that never had instance edits of prompt keys. | Full re-bake on every template save for all flows; simplest, but stomps users' instance edits silently. |
| D4 | Variable grammar (I4, I9) | **One renderer, two universes:** extend `PromptLibrary.render` to resolve dotted paths the same way the agent renderer does (shared `renderRefs(text, resolver)` helper in a new `lib/engine/prompt-vars.ts`; `agent-node.ts:28–44` and `http-node.ts:198–219` adopt it). Both renderers return `{ text, unresolved: string[] }` so UIs can flag silent empties/literals. | Keep two grammars and add a hard lint blocking dotted refs in built-in bodies. Less code churn, but keeps the mental trap. |
| D5 | Test runner | The repo has **no test runner** (no `test` script, no test deps, AGENTS §0 requires tests for new service classes). **Decided: skip adding one.** No new dev dependency is added; verification relies on a one-off parity script + the manual matrix below, and the missing unit tests for the new service classes are **flagged in the PR description** per AGENTS §0/§2.10. | Add `vitest` later if asked (separate decision). |

Everything below assumes D1(B), D2(body), D3(read-time merge + sync), D4(one
renderer), D5(no test runner: verification via script + manual matrix).

---

## 2. Phase 1 — Engine truth layer (highest value, no UI)

Make the engine record and expose one prompt per run, honestly. This alone
fixes I2 and unblocks every UI phase.

### 1.1 Persist the final prompt — and drop the redundant override plumbing

The `execute()`/`recordInput` `promptOverride` option exists only to feed
`nodes.prompt_override`, whose sole reader is the preview-route veto we remove
in 1.2. Verified: no other consumer (retry re-runs from `nodes.input`;
`components/`, `hooks/`, `app/` never read the column). So:

- `lib/engine/nodes/base/node-definition.ts`:
  - `execute()` loses the `promptOverride` option; the persisted run record is
    `opts.input` (which every caller already builds as `{ ...input, prompt }`
    with the final prompt). All 7 call sites update: build `:220`, step-build
    `:127,188`, review `:101`, resolve `:128`, agent `:194`, decision `:235`
    (already `null`), plus `pipeline-node.ts:304–308` (stop writing
    `prompt_override` in its direct `setNode`).
  - `recordInput()` loses its third parameter — plan (`plan-node.ts:353`) calls
    it with `{ ...input, prompt }` only. Retry fidelity comes from `nodes.input`
    (see `flow.ts:1458`), so the column audit claim was never load-bearing.
  - Also clear the doc comment: "audit / retry fidelity" referred to the column;
    the input blob is what retry actually reads.
- `lib/engine/nodes/agent/agent-node.ts:189`: persist the **rendered**
  final prompt into `nodes.input.prompt` (keep `nodes.config.prompt` as the
  un-rendered source of truth). Consumers of `recorded.prompt`:
  `StartView.tsx:168` deletes it defensively — re-verify each start-form
  prefill path after normalization (one grep: `recorded.prompt`,
  `input?.prompt`).
- Acceptance: after any run, `nodes.input.prompt` is byte-identical to
  `AgentStartSpec.prompt` for every node kind.

**Column decision (schema-adjacent — flag per AGENTS §1):** `nodes.prompt_override`
is not in `schema.sql`; it exists only as a runtime `ALTER TABLE` migration
(`lib/db/index.ts:96–98`) plus a row-mapper key (`rows.ts:133`) and a backup
column-preserve entry (`lib/db/index.ts:503`). With the veto gone it has no
reader. Recommendation: stop writing it in this phase and **drop it in a small
follow-up** — remove the migration block, the mapper key, the backup entry, and
add a `DROP COLUMN IF EXISTS` migration for existing DBs (SQLite 3.35+,
better-sqlite3 13 supports it). Keeping it written costs one duplicate write and
perpetuates the "two prompt states" confusion; not writing it leaves an inert
column that costs nothing but noise.

### 1.2 PromptLibrary: render the override-free preview and a last-run overlay

- `lib/engine/nodes/base/node-definition.ts`: default
  `previewPrompt(ctx, node, params): PromptAssembly | null` returning
  `assemblePrompt` from the def's knobs + default (per-def context filling —
  see 2.1). Built-ins override it; the plan sub-plan path keeps its special
  method.
- New `lib/engine/prompt-preview.ts` (service class `PromptPreview`):
  `previewFor(flowId, nodeKey, urlParams): Promise<PreviewPayload>` — owns:
  live resolution via `def.previewPrompt`, the `lastRun` overlay from
  `nodes.input.prompt` with `diverges: lastRun !== current.final`, and the
  override hint fields. Unit-testable without the route.
- `app/api/flows/[id]/prompt/route.ts`: re-serialize from `PromptPreview`
  (thin route per AGENTS 3.2). Response adds:
  `lastRun: string | null, diverges: boolean, promptSource: "modal" | "config" | "default"`.
  The stale verbatim veto (`route.ts:82–95`) is removed — I2 fixed.

### 1.3 Whitespace and data-block normalization (I7 part 1)

- Collapse multi-blank runs **inside rendered data blocks only**
  (`PromptLibrary.internalBlocks`), then delete the three per-node
  `.split("\n").filter(Boolean)` collapses
  (`review-node.ts:96`, `resolve-node.ts:~108`, `pipeline-node.ts:573–575`).
  Preview and run stay byte-identical by construction.

**Phase 1 exit criteria:** for plan/build/review/resolve/pipeline/agent —
preview `final` == persisted `input.prompt` == `AgentStartSpec.prompt` (asserted
by the parity script, §9.1); no per-node whitespace branches remain.

---

## 3. Phase 2 — Flow window surfaces (UI, I1)

### 2.1 Registry-over-switch in the preview route

Replace the `route.ts:106–159` per-node `switch` with per-def preview methods
(explicitly the AGENTS "registries over type-string switch" rule):

- `NodeDefinition.previewPrompt(ctx, node, params): PromptAssembly | null` —
  each def fills its own variables from its own run-time logic, deleting the
  duplicated instruction strings:
  - **plan**: today's `route.ts:107–119` + sub-plan branch path stays (its own
    method, called first, `route.ts:29–61`).
  - **build** (`build-node.ts`): extract the instructions builder
    (`build-node.ts:188–193`) into a def method `runInstructions(mode, branch,
    setupNote?)` used by both `run()` and preview; preview must include the
    **checklist** (`markPlanChecklist` via `planSteps.markdown(...)`) — kills I6.
  - **review / resolve**: move `route.ts:141–157` filling into the defs (same
    vars as run).
  - **pipeline** (`pipeline-node.ts`): preview fills `branch` from
    `flowCtxHelper.buildBranch`/`flow.mr_branch`, `pipelineId` when the action
    query supplies it, and a labeled stub for `{{logs}}` ("finalized at run
    time") instead of rendering `pipeline # failed on branch .` — kills I5.
  - **agent (declarative)**: `previewPrompt` renders `nodes.config.prompt`
    with the shared dotted renderer over `buildFlowContext(ctx)` + inherited
    `input` — the prompt modal becomes available for agent nodes (fixes the
    first half of I10; second half in 2.3).
- `route.ts` node-key validation moves to `def?.previewPrompt != null`
  (covers agent nodes too, no `isValidNodeKey` limit).

### 2.2 Show prompts in the cockpit panels

- **Running/last-run card:** new shared component
  `components/shared/PromptDisplay.tsx` (domain-neutral: takes
  `{ label, text, collapsible }`): collapsible "Prompt — what the agent
  receives" card. Wire into `PanelShell` (single mount point, all panels get
  it) fed from `node.input?.prompt` — already shipped to the client in the
  flow snapshot (`flow.ts:388–408` spreads the node row; `types/flow.ts:48–49`).
  Visible when `input.prompt` exists: while running (this is the "show prompt
  while running" fix), after done/failed (read-only), and as the "last ran"
  payload for the modal (`lastRun`). Skeleton mirrors the card (AGENTS 2.8);
  no empty state needed when no prompt ran (render nothing, card hidden).
- **Pre-run prompt box for all built-ins:** set `promptNode` capability on
  review, resolve, pipeline, build defs (after 2.1 they all have real
  previews). `FlowCockpit.tsx:72–78` logic already keys off the capability and
  the `ChatPanel` box renders `NodePromptBox` — extend it with a per-node
  start-action adapter in `constants/` (`NODE_START_ACTIONS` map:
  plan → `run_node`, build → manual trigger equivalent, review/resolve/pipeline
  → their action names with `prompt`/`promptIsBody` + defaults) so "Run with
  this prompt" posts the right action. The plan-specific `PlanOptions` stay
  plan-only.
- **BuildView gets an "Edit prompt" button** (component
  `components/flows/panels/BuildView.tsx`) opening `PromptModal` with
  `nodeKey=build` — the route has supported `?node=build` all along; only the
  UI was missing. Same pattern as `ReviewView.tsx:160–168`.
- **AgentView prompt card** (`components/flows/panels/AgentView.tsx:88–90`):
  switch to `useNodePrompt` + rendered preview (route now serves agent nodes),
  and show `lastRun` from `node.input.prompt` after runs.

**Phase 2 exit criteria:** every node kind, at every state
(pending / running / done / failed), has a visible truthful prompt surface; the
word `{{` appears nowhere in the default UI except in template editors.

---

## 4. Phase 3 — Knob semantics unification (I3, I11, part of I2's root behavior)

1. **Restructure the build template** (`prompt-defaults.ts:229–245`):
   `userTemplate` = `{{instructions}}\n\n{{ticket}}` (user-overridable parts),
   with `## Approved plan / {{plan}}`, the worktree instructions, and the
   `{{checklist}}` block moved to `data` blocks (kind: data, engine-authored,
   per run). Keeps the three-part invariant: user body never carries run data.
2. **Build body semantics:** `build-node.ts:157–161` folds `prompt_body`
   through `assemblePrompt(..., { body })` (blocks re-attached) instead of
   `prompts.resolve(..., override)`. Update help text (`build-node.ts:55`) and
   the template editor's Prompt tab (comes free via `templateParts`).
3. **Pipeline knob names via the def:** `NodeDefinition` gets
   `promptBodyKey`/`promptRulesKey` getters (`"fix_prompt_body"`/
   `"fix_prompt_rules"` on pipeline, `"prompt_body"`/`"prompt_rules"`
   elsewhere) — `route.ts:136,166,175–177` and
   `components/template-editor/config-field-logic.ts:29–46` read them instead
   of hand-coded switches. Kills I15's drift surface.
4. **`step_build` honors rules:** `step-build-node.ts:117–122` passes
   `{ userRules: configString(config, "prompt_rules") }` — note step children
   *have* the parent's baked config snapshot, verify with the fanout seed
   (`npm run seed:demo:fanout`). Kills I11.
5. **`bakeNodeConfig` adoption (I14):** call it in `flow.ts:125,203`;
   delete the inline merges.

**Behavior change to flag in the PR (AGENTS §4.3):** build `prompt_body` stops
being a full-prompt replacement. Existing setup flows that used the knob as an
override (none known; `config` values live in `node_templates`/app settings)
must be re-checked at rollout; document in the PR description.

---

## 5. Phase 4 — Template-config freshness (I1 issue 3, D3)

1. `lib/engine/node-config.ts`:
   - `set_node_config` writes only into `config["#instance"]` for prompt knobs
     (`prompt_body`, `prompt_rules`, `fix_prompt_*`) from the flow window;
     other keys keep instance-layer semantics (conservatives: all
     `set_node_config` writes go to `#instance`).
   - `effectiveConfig(defKey, node)` becomes
     `mergeConfigLayers(appLayerConfig(defKey), liveTemplateConfig(flowId,
     defKey), instanceLayer(node.config))`.
   - `lib/engine/templates.ts`: `liveTemplateConfig(flowId, defKey)` resolves
     the flow's template node config (template → `flow_template_nodes.config`
     → catalog `node_templates.config`, mirroring `flow.ts:121–136` merge).
2. UI honesty (only after 2.2 lands): when `diverges` is true (the last run's
   prompt differs from the current live resolution), the modal shows a
   "Template/Config changed since the last run" note next to the read-only
   `lastRun` collapsible instead of silently picking one.
3. Checkbox for user choice in the modal when a *saved* body is stale? No —
   no persistence, keep it display-only.

**Exit criteria:** edit `prompt_body` in the template editor → open an existing
flow → the prompt box/modal shows the new body immediately (when the instance
has no prompt edits).

---

## 6. Phase 5 — One variable grammar, warnings, chips (I4, I8, I9, D4)

1. `lib/engine/prompt-vars.ts` (new): `renderRefs(text, resolver):
   { text, unresolved: string[] }` — dotted-path resolver, identical output for
   all renderers (AGENTS: pure helper, may stay function).
2. `PromptLibrary.render` uses it: built-in bodies now support both
   `{{ticket}}` and `{{task.key}}` shapes (universe per def: flat ctx ∪ dotted
   flow context). The declarative path (`agent-node.ts:28–44`,
   `http-node.ts:198–219` interpolate, decision-node comment interpolation)
   switches to the same helper (`{{secrets.*}}` stays HTTP-only).
3. **Unresolved-var surfacing:** the preview payload gains
   `unresolved: string[]`; the `PromptModal` renders an inline warning next to
   the textarea ("2 unresolved variables sent literally to the agent") per
   AGENTS 2.8 (this is the error state for that async flow).
4. **Chips truthfully derived** (`use-flow-prompt.ts` seeding + `templateParts`):
   `variables` stays the display metadata but is validated against
   `\{\{([^}]+)\}\}` matches rendered across the template; mismatch listed in
   the settings page (no crash).
5. `lib/engine/context-lint.ts`: extend the ref lint to built-in prompt knobs
   (`prompt_body`, `prompt_rules`) — a dotted ref must resolve in that node's
   universe, else lint error at template save.

**Exit criteria:** a typo'd or cross-universe variable in any prompt surface is
either resolvable or loudly warned — never silently empty/literal.

---

## 7. Phase 6 — Cleanup & polish (I13, I14 remaining, I12)

- `use-flow-prompt.ts:194–205` legacy `final.startsWith(prompt)` fallback:
  remove once the server always supplies `finalTail` (1.2 guarantees it).
- Template editor (`PromptTab.tsx`) header copy: label the unrendered view
  "Template (variables shown as {{…}})" vs the modal's rendered view (I13).
- StartView's `delete recorded.prompt` becomes unnecessary; remove + re-verify
  the start prefill.
- `I12` dies via 1.1 (single semantics: `input.prompt` = final, always).
- `I8` (chips) dies via Phase 5.4.

## 8. Execution order, sizing

| Phase | Fixes | Touches | Est. | Depends on |
|-------|-------|---------|------|------------|
| 1 engine truth | I2, I7 | node defs, prompts.ts, preview service | M | D1 |
| 2 registry previews + UI | I1, I5, I6, I10 | route, defs, cockpit, shared | L | 1 |
| 3 knob semantics | I3, I14, I15, I11 | prompts defaults, build/step-build, editor | M | 2.1 |
| 4 freshness | I1 | node-config.ts, templates.ts | M | 1, 2 |
| 5 vars | I4, I8, I9 | prompt-vars.ts, renderers, lints | M | 1 |
| 6 polish | I12, I13 | hooks, editor copy | S | 1–5 |

(Phases 1+2 are the PR-worthy core; 3–6 can land as separated PRs. Phases 1 and
5 touch `lib/engine/prompts.ts` concurrently — land 1 first.)

## 9. Verification (no test runner — D5 decided)

Assert the one invariant this plan exists for — **preview == recorded ==
sent** — plus the per-phase exits, without a test framework:

1. **One-off parity script** (`scripts/verify-prompt-parity.mjs`, run only
   against the demo DB path — check `lib/config.ts`, never a real DB, AGENTS §1):
   for a seeded demo flow (`npm run seed:demo:reset`, plus `seed:demo:fanout`
   for the step-build rows), compare each node kind's `previewPrompt` assembly
   with what `run()` would persist as `nodes.input.prompt`. Prints a PASS/FAIL
   table per node kind (plan, build, step_build, review, resolve, pipeline fix,
   agent).
2. **Manual prompt-lifecycle matrix** (does not require agent runs):
   - pre-run: prompt box/modal preview matches the template or the `prompt_body`
     config edit for every built-in node.
   - mid-run: the cockpit `PromptDisplay` card shows the running prompt.
   - post-run: `lastRun` == `nodes.input.prompt`; editing the template config
     now changes the preview while `lastRun` stays the record of run N.
3. **Scenario checks on the seed flows**:
   - `seed:demo:fanout` → step child honors `prompt_rules` (Phase 3 exit).
   - `seed:custom` (declarative agent) → modal renders the dotted-prompt
     preview and warns on unresolved `{{…}}`; a dotted ref typed into a
     built-in body renders or warns (Phase 5 exit).
   - run `seed:demo:reset`, then edit `prompt_body` in the template editor →
     the flow window shows the new body (Phase 4 exit).
4. Per AGENTS §0/§2.10: the PR description flags that the new service classes
   (`PromptPreview`, `renderRefs`) have no unit tests because the repo has no
   test runner — to be revisited if one is ever added.

## 10. Acceptance checklist (per audit issue)

- [ ] I1: every node shows its real prompt: pre-run box (all built-ins),
      running card, last-run overlay; agent nodes included (2.2, 1.1).
- [ ] I2: preview returned by `PromptPreview` is `current`-resolved; `lastRun`
      shown read-only; config edits always visible (1.2).
- [ ] I3: one `prompt_body` meaning everywhere; build keeps the plan after a
      body edit (Phase 3).
- [ ] I4/I9: one renderer; unresolved vars warned or linted (Phase 5).
- [ ] I5/I6: preview vars filled by defs; checklist present; instructions not
      paraphrased (2.1).
- [ ] I7: preview == run byte-for-byte (1.3 + 1.2).
- [ ] I8: chips derived/validated (5.4).
- [ ] I10: modal + rendered preview for agent nodes (2.1, 2.2).
- [ ] I11: step children respect `prompt_rules` (3.4).
- [ ] I12: single `input.prompt` semantics, StartView cleanup (1.1, Phase 6).
- [ ] I13: rendered vs unrendered views labeled (Phase 6).
- [ ] I14: `bakeNodeConfig` used or deleted (3.5).
- [ ] I15: knob names from defs; pipeline special-case central (3.3).
- [ ] AGENTS §0: `npm run build`, `npm run lint` green; loading/error/empty
      states for the new UIs; diff focused per phase; flagged behaviors listed.
