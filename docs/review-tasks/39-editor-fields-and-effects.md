# Task 39: Template editor: fields that write correct values

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 38: Template editor: draft updates, undo/redo and read-only](38-editor-draft-machine.md)
- **Findings:** CR-031, CR-033, CR-034, CR-137, CR-138, CR-241, CR-242, CR-146, CR-163
- **Effort:** L

## Goal

HTTP headers become a string, opening a tab dirties the draft, path autocomplete traps focus, the condition grammar loses quoting, list rows use index keys, and several components sync props into state with effects (including the two `eslint-disable exhaustive-deps`).

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-031 [High] Editing HTTP "Headers" writes a string into a `Record<string,string>` field and breaks the node

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/components/ConfigPlainField.tsx:55-69; lib/engine/nodes/kinds/http/http-node.ts:43 (headers declared `type: "text"`); lib/engine/nodes/declarative-schemas.ts:122 (`z.record(z.string(), z.string())`)
- **What to do:** HTTP `headers` is still a `"text"` field rendered as a Textarea that writes `e.target.value` verbatim, so the first keystroke replaces the record with a string and the node config fails Zod. Add a `kv`/`json` field type (a JSON textarea with a local buffer that parses on blur and shows errors, or a key/value editor) and declare headers with it.

### CR-033 [High] Opening the Start "fields" or Output-schema tab dirties the draft and turns catalog defaults into instance overrides

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/components/StartContractEditor.tsx:70-93; components/template-editor/hooks/use-output-schema-draft.ts:44-69 (eslint-disable at 68)
- **What to do:** Both components still emit `onChange` from mount and change effects, so just opening the Start "fields" or Output-schema tab dirties the draft (including on read-only built-ins) and freezes the catalog default `output_schema` into instance config. Emit only from user input handlers, derive the displayed text from `config ?? default` during render, skip writes that deep-equal the effective value, and drop the ref and `eslint-disable` workaround.

### CR-034 [High] Path autocomplete hijacks Tab/Enter, auto-inserts the first variable, and traps keyboard focus

- **Status:** Open
- **Type:** Accessibility
- **Effort:** S
- **Where:** components/template-editor/condition-builder/PathAutocomplete.tsx:64-93 (highlight starts at 0, window capture keydown, Tab/Enter preventDefault); components/template-editor/condition-builder/PathField.tsx:45 (opens on focus); components/template-editor/condition-builder/ExpressionInput.tsx:98
- **What to do:** The popover still opens on focus with an empty token, and a window capture-phase listener turns Tab or Enter into "pick the first option", so tabbing through a path field inserts a variable and traps focus (WCAG 2.1.2). Open only on typing or ArrowDown, start `highlight` at -1, never intercept Tab, and move the handler to the input's `onKeyDown`.

### CR-137 [Medium] Condition builder round-trip changes expression semantics

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/condition-grammar.ts:24-37, components/template-editor/condition-grammar.ts:74-116, components/template-editor/condition-grammar.ts:160-176
- **What to do:** `decomposeCondition` still only checks the LEFT side with `isPath` and runs any RHS through `unliteral()`, so `status = nodes.b.output.y` becomes the string literal on the next edit. `literal()` re-emits `"123"` and `"true"` as the bare number and boolean, and `splitTop` ignores escaped quotes (lines 81-84). Fix: decompose only when the RHS is a valid literal (else raw mode), store `{ value, kind }` so quoting survives, and add vitest round-trip tests (the runner now exists).

### CR-138 [Medium] ConditionBuilder keeps stale rows when its value becomes empty; index keys make it reproducible

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/condition-builder/use-condition-state.ts:41-54, components/template-editor/condition-builder/use-condition-state.ts:79-83, components/template-editor/components/ChoicesEditor.tsx:45-47, components/template-editor/components/PassMapEditor.tsx:43, components/template-editor/components/RulesListEditor.tsx:33, components/template-editor/condition-builder/ConditionBuilder.tsx:131
- **What to do:** The seed effect still skips when `!value && !lastEmitted.current`, and `ChoiceRow` (plus PassMap, Rules and condition rows) still use `key={i}`. Deleting a choice therefore leaves the previous choice's condition rows showing under the next one, and the next edit emits them into the wrong choice. `editRaw` still calls `onChange` on every keystroke. Fix: give list items stable ids, and derive rows from `value` during render with only a raw-text buffer in state, reset via `key`.

### CR-241 [Low] Prompt editor never syncs an externally changed value

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/hooks/use-prompt-editor.ts:85-118, components/template-editor/PromptEditor.tsx:59
- **What to do:** `useEditor` is still seeded once with `content: textToHtml(value)`, and nothing calls `setContent` when `value` changes from outside (the only effect only re-dispatches decorations). Add an effect that calls `editor.commands.setContent` when `value` differs from the last emitted text, or key `PromptEditor` by node and field.

### CR-242 [Low] Schedule interval input can't be cleared or retyped

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/FlowSettings.tsx:113,118, components/template-editor/components/FlowSettingsSchedule.tsx:76-89
- **What to do:** `intervalMin={Number(trigger.interval_min ?? 60)}` still snaps an empty input back to 60, because the onChange handler emits `undefined` for non-positive values. Keep a local string buffer in the input, commit only valid positive numbers on change or blur, and show a validation hint when the field is empty.

### CR-146 [Medium] State-mirroring effects and render-time ref writes (AGENTS.md §2.6)

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** components/builder/hooks/use-instance-contracts.ts:94-134, components/templates/hooks/use-node-schema-contract.ts:39-51, components/template-editor/hooks/use-input-map.ts:87-91, components/template-editor/hooks/use-configurator-tabs.ts:43-67, components/template-editor/hooks/use-node-positions.ts:39-40
- **What to do:** All patterns remain: a render-time ref write plus the `void choiceSig` memo trick, query data copied into state by an effect, an editing-row reset effect keyed on `node.key`, and a render-time tab reset plus an effect on `[contract, node]` that keeps re-forcing the Prompt tab while config is empty. There is also a render-time `latest.current = positions`. Fix: derive during render, reset per-node UI state via `key={node.key}`, pick the initial tab once per node key, and use a memoized choices signature string as a real dependency.

### CR-163 [Medium] Two inline `react-hooks/exhaustive-deps` suppressions in the template editor, and lint does not block inline disables

- **Status:** Open
- **Type:** Infra
- **Effort:** S
- **Where:** components/template-editor/components/BuilderApiBridge.tsx:14-19, components/template-editor/hooks/use-output-schema-draft.ts:44-69, components/template-editor/components/BuilderFlow.tsx:207, eslint.config.mjs:18-193
- **What to do:** Both inline `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions remain, and the config has no `linterOptions.reportUnusedDisableDirectives` and no guard against disabling the rule. `BuilderFlow` still wraps `onApi` in an inline lambda, so it is never stable. Fix: make `onApi` stable (`useCallback` in EditorPage, passed straight through) and list it, move output-schema parsing into the change handler, and add `reportUnusedDisableDirectives: "error"` plus a disable-ban (the plugin is a new dep and needs approval).
- **Fix after:** CR-033 (this task), CR-145 ([Task 40](40-editor-performance.md))

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
