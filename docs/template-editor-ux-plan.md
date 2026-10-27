# Template Creation UX — Audit & Implementation Plan

*Full audit of the template-creation journey (gallery → editor → configurator → canvas) plus the
variable-injection / JSONata analysis, and the phased plan to fix both. Engine runtime is untouched
except where noted (Phase 5 preview endpoint, Phase 2 PATCH extension, Phase 5 lint shape).*

**Guiding principles — every phase must obey:**

1. One way to do each thing: one add-node path, one prompt editor, one schema format, one save model.
2. Nothing is created server-side before the user commits (Save).
3. Power features (JSONata, conditions, schemas) are progressive — the default path never shows them.
4. Every ref / expression is validated *where it's typed*, not at Save.

---

## Part 1 — Audit summary

### A. Gallery (`app/templates/page.tsx`)

| # | Inconsistency | Fix |
|---|---|---|
| A1 | "New template" dialog is a speed bump — asks Name/Description before anything exists, empty name allowed anyway | Delete the dialog; "New template" creates *Untitled flow* instantly and opens the editor (name lives in Flow settings) |
| A2 | Native `confirm()` for delete vs styled UI everywhere else | Styled AlertDialog |
| A3 | "Your templates" heading renders even when empty | Heading only when non-empty; inline empty-state hint |
| A4 | Import is paste-only; validation errors land as a page-top alert | File upload + drag-drop; client/validate-endpoint feedback inside the dialog, near the offending line |
| A5 | Import & New dialogs have no Cancel button | Explicit Cancel |
| A6 | Starters' "Open" is really read-only "View" | Label "Preview" for built-ins |

### B. Editor shell (`app/templates/[id]/page.tsx`)

| # | Inconsistency | Fix |
|---|---|---|
| B1 | Two persistence models: drags autosave (debounced positions PATCH) but structural edits need explicit Save | One honest header state: "Layout autosaved · graph has unsaved changes" (explicit Save stays — matches snapshot-on-save semantics) |
| B2 | No unsaved-changes guard | `beforeunload` + styled confirm on back link when dirty |
| B3 | Duplicated dead code: Flow-settings button rendered in both `{readonly}` and `{!readonly}` branches | One button |
| B4 | Read-only built-ins force a gallery round trip to duplicate | "Duplicate to edit" button directly in the read-only header |
| B5 | DIY routing: `location.pathname` parsing + `location.assign` full reloads | `useParams()` + `router.push` |
| B6 | Error and notice share one floating alert with a hand-rolled ✕ | Errors persistent; notices → toasts with auto-dismiss |

### C. Three ways to add a node — the core overwhelm

1. Palette catalog rows (place a catalog instance)
2. Palette kind buttons — one click creates a **server-side `node_templates` row** → orphan rows
   pollute every future palette; catalog caches (`NodePalette`, `AddNodeDialog`) never invalidate
3. `AddNodeDialog` "Author with the full form…" — bespoke per-kind forms

Additional inconsistencies inside those paths:

| # | Inconsistency | Fix |
|---|---|---|
| C1 | Agent prompt: plain `Textarea` in dialog vs rich `PromptEditor` (with @ popover) in drawer | `PromptEditor` everywhere (moot after C6) |
| C2 | Output schema authored in two formats: agent/start accept TS-lite, script only raw JSON Schema | TS-lite everywhere (JSON paste still accepted) |
| C3 | Decision form's delete-choice button is a `Wrench` icon; drawer's `ChoicesEditor` uses `Trash2` | Trash2 everywhere (moot after C6) |
| C4 | "Author with the full form…" hardcodes `onOpenAuthoring("agent")` despite 4 kinds | Dialog removed (C6) |
| C5 | Reopening the dialog always resets to `initialMode` | moot (C6) |
| C6 | **Collapse to one path:** kind tiles place an in-memory instance; the drawer's schema-driven Config tab is the single authoring surface; catalog rows persist only on template Save; dialog deleted | Phase 2 |

### D. Node configurator

| # | Inconsistency | Fix |
|---|---|---|
| D1 | Tab auto-selection is stateful-by-surprise (fresh → Config, else Trigger) | Config for fresh nodes on first open; keep the user's tab thereafter |
| D2 | **Two meanings of "start node"**: the `nt_start` catalog instance vs the *relationship* "nothing points at it" used in the locked copy | Relationship renamed "entry node / triggered branch"; "Start node" reserved for the catalog instance |
| D3 | **Two "trigger" concepts named identically** (template-level manual/webhook/schedule vs node-level auto/manual/approval/debounced+wait_for) | Template one renamed "Flow trigger" everywhere |
| D4 | Tabs vocabulary drift: `Run Context` vs `Contract` for the same mental slot | "Start fields" (start editor) / "Inputs & outputs" (contract view) |
| D5 | Legacy `NodeConfigurator` default export (Dialog variant) duplicates the drawer | Verify unused → delete |
| D6 | Chip insertion appends to end of value vs PromptEditor's insert-at-cursor vs focus-row insert in Choices/PassMap | One cursor-aware insertion helper |
| D7 | Jargon density: TS-lite, JSONata, join modes, `ts_output` companion keys all at the same visual weight as the prompt | Progressive disclosure: prompt/mode visible; schema / JSONata / join-mode / wait-for under "Advanced" |

### E. Edge editor

| # | Inconsistency | Fix |
|---|---|---|
| E1 | Full From/To/Kind/Label/Condition form for what is usually one decision branch | Contextual drawer: decision-labeled edges show the branch chip picker; kind/condition/rewire under "Advanced"; plain edges = one-line summary + delete |
| E2 | Loop-kind semantics are a wall of text | Rename `loop` → "retry / repeat", one sentence |
| E3 | Fragile edge identity: `Number(id.replace(/[^0-9]/g, ""))` index-based ids | Stable ids (`from-to-label`) for selection |
| E4 | Duplicate-label check mishandles decisions (two branches may share a target) | Key the check on `from+to+label` |

### F. Flow settings

| # | Inconsistency | Fix |
|---|---|---|
| F1 | Template meta (name/description) lives here AND in the gallery dialog | After A1, settings is the single home; consider click-to-edit name in the header |
| F2 | Task context / trigger / repo / JSONata filter / hook secret all at the same visual level; secret printed in plaintext | Group "When flows start"; filter + hook details under "Advanced"; secret masked with reveal/copy |
| F3 | "Hook appears once the template is saved" is ambiguous given the hybrid persistence | Resolved by B1 |

### G. Canvas mechanics

| # | Inconsistency | Fix |
|---|---|---|
| G1 | Plain-node handles hover-only; decision branch handles always visible — inconsistent | Source handles always visible; target handles hover-revealed |
| G2 | New nodes spawn at viewport center with no overlap handling; dagre exists but no tidy action | "Tidy layout" control next to zoom |
| G3 | No node duplicate/copy on canvas | Right-click → Duplicate node (reuse `uniqueKey`, copy config) |

---

## Part 2 — Variable injection & propagation: how it works, where it breaks

### How it actually works

**Universe** (`lib/engine/flow-context.ts`) — one map everything evaluates against:

| Root | Contents | Set by |
|---|---|---|
| `task.*` | starting task + provider contextFields | flow's task |
| `repo.*` | `cloud_url`, `local_path` | template binding |
| `flow.*` | `mr_url`, `mr_branch` | engine |
| `trigger.payload.*` | start payload / webhook delivery | trigger |
| `nodes.<key>.output.*` | every finished node's output | node run |
| `input.*` | merged output of all `next`-edge parents, **last wins** | inheritance |
| `secrets.*` | configured secrets | http nodes only |

**Two syntaxes:** `{{...}}` template refs (prompts, http url/headers/body) vs **raw JSONata**
(edge conditions, decision expression / per-choice conditions, `pass` map, `input_map`, http
`response_map` — no `{{}}` wrapper; the same path string means different things per field).

**Injection:** implicit inheritance (parents' outputs merged, last wins) + explicit chips /
`@` popover + `input_map` (per-field JSONata overlay — **engine feature with zero editor UI**;
it round-trips through the editor but nothing can create or edit one. YAML-only today).

**Strong foundations:** `lintTemplate` statically checks every ref and expression at save with
readable messages; secrets deliberately outside the context map; contracts expose field vocab.

### Gaps

1. **`input_map` is a ghost feature** — the common need "this field comes from a grandparent /
   another branch" can't be expressed in the visual builder.
2. **Implicit merge is silent and lossy** — two parents publishing `summary` collide with no
   warning; nothing shows merge order.
3. **`{{input.*}}` is ambiguous by design** — resolves against "whatever the merged object
   contains", which changes silently on rewire; `{{nodes.*}}` is explicit but keyed on invisible slugs.
4. **Chip vocabulary is a subset of the universe** — no `trigger.payload.*`, `repo.*`, `flow.*`,
   or `secrets.*` offered; users hand-type and typos surface only at Save.
5. **No secrets picker** — http config documents `{{secrets.NAME}}` but nothing lists existing secrets.
6. **Feedback loop is save-time only** — lint lives behind Save and arrives as one concatenated
   wall of problems, not attached to the offending node/edge.
7. **Three overlapping branching mechanisms, one name** — edge `condition`, decision `expression`
   source, decision per-choice conditions; no UI guidance on which to use when.
8. **Refs are keyed on invisible slugs** (`nodes.review.output.*`) while users see different labels.

### JSONata UX — grade the difficulty

- **Tier 1 — Condition builder (no JSONata visible):** structured `[variable ▾][op ▾][value]` rows
  (ops: `=`, `≠`, `>`, `<`, `contains`, `is empty` → generates `!= null`), AND/OR composition,
  type-aware value fields, compiles to JSONata; small "edit raw expression" toggle.
- **Tier 2 — Autocomplete in raw boxes:** path completion popover (nodes → keys → output → fields)
  with the same vocabulary as the prompt `@` menu.
- **Tier 3 — Live feedback:** `lintJsonata` is client-importable (pure JS, no server deps) → compile
  errors inline on change; `{{refs}}` validated live via validate endpoint, underlined inline;
  **expression preview** against the last run's context (`= true` rendered under the editor).
- Plus: save errors attach to their node/edge as canvas badges; one reusable "Variables" cheat-sheet;
  secrets chip group (http-only) populated from configured secret names.

**Design principle adopted:** *prompts reference intent, mapping references wiring* —
"My inputs" items insert `{{input.<field>}}` (logical); node-group items insert
`{{nodes.<key>.output.<field>}}` (physical). Re-mapping a field's source never breaks prompts.

---

## Part 3 — Implementation plan

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                │            │
                └──► Phase 6 (independent items anytime)
                             └──► Phase 5
```

### Phase 1 — Canvas: manual connect, keyboard, undo (no API changes)

Files: `app/templates/[id]/page.tsx`, `BuilderCanvas.tsx`, `NodeConfigurator.tsx`

- Remove `connectNew` + `entryBranch` pre-wiring from `addInstance`. New node = viewport center,
  selected, unconnected, drawer does NOT auto-open. Hint: "Drag from a node's handle to connect it."
- Isolation gate softens: the amber "Needs a connection" block becomes an inline note above the
  form; prompt/knobs editable; variables show Task context + "Connect a node to inherit its
  outputs." Amber `!` canvas dot stays.
- Start seeding silent for new templates (notice kept for legacy-empty ones).
- Keyboard delete: `deleteKeyCode: ["Backspace","Delete"]`; handle `remove` changes in
  `onNodesChange`/`onEdgesChange` → `removeNode`/`removeEdge` (never delete `nt_start`).
- Undo: snapshot draft in `apply()` (structural only); Ctrl/Cmd+Z / Shift+Z; redo stack.
- `beforeunload` guard + styled confirm on back link when dirty.

Effort ~1 day · risk low.

### Phase 2 — One panel + deferred node creation (API change)

Files: `NodePalette.tsx`, `AddNodeDialog.tsx` (deleted), editor page,
`app/api/contracts/route.ts`, `app/api/templates/[id]/route.ts`

Left panel:

```
NODES
  Standard   ▸ Start (locked if exists) · Plan · Build · Pipeline · Review · Resolve
  New node   [ Agent ] [ Decision ] [ HTTP ] [ Script ]
  Library ▾  (collapsed — persisted custom nodes, reusable across templates)
```

- Kind tiles / Library picks place an in-memory instance: `nodeTemplateId: "draft:<n>"` with the
  def (`kind`, `name`, `config`) in `draft.pendingDefs`. **No POST at click time.**
- `/api/contracts` learns to synthesize: `?kind=agent&config={…}` alongside `?def=…` — resolve the
  declarative class via the registry without a row (it already merges instance config over the def).
- `PATCH /api/templates/[id]` accepts `new_node_templates: [{ draftId, kind, name, icon,
  description, config }]`; route creates rows first, remaps ids by `draftId`, then the existing
  save path (lint included). Atomic from the client's view.
- Export guard: `/export` refuses `draft:` ids (409 "Save before exporting").
- Catalog cache invalidated after Save.
- Library = `GET /api/node-templates` filtered to persisted declarative rows, collapsed by default.
- `AddNodeDialog` + its four bespoke forms deleted; drawer is the single authoring surface
  (fixes C1/C3 automatically).

Effort ~2 days · risk medium (PATCH contract change).

### Phase 3 — Grouped variable popover + color-coded refs (editor-layer only)

Files: `PromptEditor.tsx`, new `variables.ts` (shared vocabulary), `NodeConfigurator.tsx`

Shared vocabulary shape (used by popover, chips, condition builder, mapping picker):

```ts
type VarGroup = {
  id: "inputs" | "task" | "upstream" | "trigger" | "http-secrets";
  title: string;   // "My inputs" / "Task" / "Upstream: Review" / …
  origin?: string; // "inherited from Review" / "mapped: Build.plan"
  fields: { name: string; type?: string; description?: string; insert: string }[];
};
```

- Popover groups: My inputs (Phase 4 fills; before that it's "Inherited" from parent merge) →
  Task → Upstream nodes (header per node, typed fields) → Trigger. Search filters flat; headers
  render only when non-empty.
- Color-coded inline refs: `{{input.*}}` blue (logical), `{{nodes.*}}` violet (physical), other
  roots neutral — one glance shows which prompts are wiring-dependent.
- VariableChips get grouped separators, or are superseded by a per-field "Variables ▾" popover
  (leaning toward the popover for consistency).
- Live `{{ref}}` validation via the validate endpoint, debounced, underlined inline.

Effort ~1 day · risk low · ships standalone (full "My inputs" semantics in Phase 4).

### Phase 4 — Inputs / mapping (the ghost `input_map` gets UI)

Files: `NodeConfigurator.tsx`, `variables.ts`, editor page

- Drawer tabs become `Trigger · Inputs · Config · Contract` (Start keeps its two).
- Inputs section:

```
INPUTS — what this node receives
  summary      ← Review · output.summary     inherited   [re-map] [✕]
  branch       ← Build · output.plan         mapped      [re-map] [✕]
  ticket_key   ← Task · key                  mapped      [re-map] [✕]
  + Map a field
```

- Inherited rows listed from parent contracts (greyed); conflict badge when two parents publish
  the same field (makes the last-wins merge visible).
- Source picker grouped dropdown: Upstream nodes → Task context → Trigger payload → Flow/Repo →
  "Custom expression (JSONata)" as the visually separated advanced item.
- Writes `input_map[field] = "nodes.build.output.plan"` — the engine's existing shape
  (`evalInputMap` overlays it). Zero runtime changes.
- Deleting a mapped row removes the override (falls back to inherited); inherited rows aren't deletable.
- Field name defaults to the source field's name; slug-validated.
- Prompt integration: "My inputs" = inherited overlaid with `input_map`, origin badges;
  picks insert `{{input.<field>}}`. Re-mapping never breaks prompts.

Effort ~2 days · risk low-medium · depends on Phase 3.

### Phase 5 — JSONata graded UX (only phase touching the engine's API surface)

Files: new `ConditionBuilder.tsx`; `EdgeEditor` / `ChoicesEditor` / `PassMapEditor` /
`SettingsBody`; new `app/api/templates/[id]/preview/route.ts`; `context-lint.ts` shape

- **Condition builder** replaces raw boxes for edge conditions, decision per-choice conditions,
  webhook filter (Tier 1 above).
- **Autocomplete** in remaining raw boxes: pass-map expressions, response_map, edited-raw (Tier 2).
- **Live feedback:** `lintJsonata` imported client-side (pure JS) → inline compile errors;
  `{{refs}}` validated live; **`POST /api/templates/[id]/preview`** — `{ expr }` in, server builds
  context from the template's most recent flow run (`buildFlowContext`), returns `{ value }` or
  error; renders `= true` under the editor. Canned sample when no run exists. Same affordance for
  pass-map / response-map.
- **Structured lint:** `lintTemplate` returns `{ nodeKey?, edgeIndex?, problem }[]` (joined string
  kept for backward compat); canvas renders error badges; drawer jumps to the field. Validate runs
  on Save click *before* PATCH.
- **Validate endpoint:** `POST /api/templates/[id]/validate` — draft in, structured problems out.
  Debounced per drawer while editing (serves Phases 3 + 5 + pre-save).

Effort ~3 days · risk medium · depends on Phase 3.

### Phase 6 — Convergence cleanup

| Item | Change |
|---|---|
| Save model | Explicit Save stays; honest header state ("Layout autosaved · graph has unsaved changes"); hook-provisioning notice consistent with it |
| Terminology | "Start node" = catalog instance only; relationship = "entry/triggered node"; template trigger = "Flow trigger" everywhere; tabs renamed per D4 |
| Controls | All raw `<select>` → shadcn Select (SettingsBody, EdgeEditor, output mode); native `confirm()` → AlertDialog in gallery |
| One schema format | Script `output_schema` accepts TS-lite (same parser as agent/start); JSON paste stays accepted |
| Secrets | Http Config tab secrets chip group from configured names; Settings hook secret masked with reveal/copy |
| Settings grouping | "When flows start" visible; JSONata filter + hook details under "Advanced" |
| Dead code | Delete `NodeConfigurator` default export (verify importers), `.every(() => true)` artifact, duplicated readonly settings button |
| New template | Instant create as *Untitled flow* (A1); gallery headings/empty states (A3); import gets Cancel + inline validation (A4) |
| Canvas polish | Always-visible source handles (G1), "Tidy layout" (G2), right-click → Duplicate node (G3) |

Effort ~1.5 days · risk low.

---

## Effort & risk summary

| Phase | Effort | Risk | Payoff |
|---|---|---|---|
| 1 Canvas behavior | ~1 day | low | removes the top daily annoyance |
| 2 Panel + deferred creation | ~2 days | medium | stops catalog pollution; single authoring surface |
| 3 Grouped variables | ~1 day | low | makes variables legible |
| 4 Mapping/Inputs | ~2 days | low-med | unlocks the engine's most practical feature |
| 5 JSONata tiers | ~3 days | medium | makes the power features usable |
| 6 Convergence | ~1.5 days | low | coherence |

**Suggested start:** Phase 1 + Phase 6 quick wins in one pass (independent, low-risk, remove most
daily friction), then Phase 2.

## Testing notes

- Lint parity tests for the structured refactor (joined string vs structured array — same problems).
- Save/import/export round-trip test asserting no `draft:` ids anywhere.
- Phase 4 runtime test: `input_map` overlay + `{{input.*}}` re-resolution after re-mapping.
- ConditionBuilder compile-and-lint unit tests.

## Explicitly deferred (bigger engine work)

Named output pins on edges · template versioning UI · multi-publisher deterministic merge
strategies. None block the phases above.
