# Plan: remove the `prompt_rules` (and `fix_prompt_rules`) knob

## Motivation

"Your rules" promises standing rules are applied on every run, but they are only
advisory — the agent may ignore them. A user can write the same rules straight
into the prompt body / override, where they are also advisory and the user knows
it. Keeping the knob costs one config field per prompt node, a bespoke list
editor, an assembly slot between body and locked blocks, and rules plumbing
through `assemblePrompt` / `resolve` / previews / tests. Removing it deletes all
of that; nothing is lost that the prompt body can't do.

## Scope (audit result)

- Knob keys: `prompt_rules` on plan, build, review, resolve; `fix_prompt_rules`
  on pipeline. Both are the same mechanism — both go.
- Runtime assembly: `PromptLibrary.assemblePrompt(nodeKey, ctx, extra, { body,
  userRules })` and `resolve(nodeKey, ctx, extra, override, { userRules })`
  insert the rules between the body and the engine's locked blocks
  (`lib/engine/prompts/promptLibrary.ts`).
- Preview path: every def's `previewPrompt()` returns `rulesKey` and folds
  `nodeRoles.previewRules(...)` into its assembly; `PromptPreview` exposes
  `userRules` + `rulesKey` on the payload (`promptPreview.ts`).
- UI write path: the template editor's "Your rules" list —
  `PromptSectionField.tsx` + `RulesListEditor.tsx`, routed by
  `rulesKeyFor()` (`configFieldLogic.ts`) in `PromptTab.tsx` and
  `DeclarativeConfigFields.tsx`.
- No flow-level consumer left: the prompt modal is already deleted;
  `hooks/useFlowChat.ts` only selects `payload.prompt` (the body) from the
  preview API, so `userRules` / `rulesKey` on the payload are dead client-side.

## Data policy (no migration)

Stored `prompt_rules` values (nodes.config JSON, template definitions, app-layer
settings via `appLayerConfig`) become inert unknown keys after removal. The
defs' `configSchema` is a default (non-strict) `z.object`, so leftover keys pass
validation and are simply ignored — no schema change, no DB migration. Demo seed
scripts never set the knob. We ship a note in the PR description instead of a
cleanup script.

## Steps

### 1. Prompt library (core)

`lib/engine/prompts/promptLibrary.ts`:

- Drop `userRules` from `PromptAssembly`, `PromptSections`, and `sectionsOf`.
- Drop the `userRules` opt from `assemblePrompt` (`final` joins `body` + blocks)
  and from `resolve` (override path returns the trimmed override).
- Update the JSDoc that references the `prompt_rules` knob.

### 2. Role router + preview service

- `lib/engine/nodes/shared/nodeRoles.ts`: remove `rulesKey` from
  `NodePromptPreview`; delete `previewRules()`.
- `lib/engine/prompts/promptPreview.ts`: remove `userRules` and `rulesKey` from
  `PromptPreviewPayload` and the payload builder (delete the
  `?? "prompt_rules"` fallback).
- `lib/engine/prompts/promptDefaults.ts`: header comment mentions the knob —
  drop it.

### 3. Node defs (same pattern per def: schema knob → configFields entry → run-time read → preview fold)

- `lib/engine/nodes/kinds/build/buildNode.ts` — `prompt_rules`: configSchema
  line ~103, configFields line ~129, `run()`'s `userRules` into
  assemble/resolve, the `refine()` path, the shared compose-args `userRules`
  member (~434–524), `previewPrompt` (`previewRules` + `rulesKey`).
- `lib/engine/nodes/kinds/review/reviewNode.ts` — same (schema ~50, fields ~63,
  run ~123, preview ~111–113).
- `lib/engine/nodes/kinds/resolve/resolveNode.ts` — same (schema ~45, fields
  ~56, run ~91, preview ~79–81).
- `lib/engine/nodes/kinds/plan/planNode.ts` + `planPrompt.ts` — `run()`
  turn-prompt wiring (~168–213), preview (~402–419); drop the `userRules`
  parameter from `refineTurn` / `whole` / `scoped`.
- `lib/engine/nodes/kinds/plan/constants/config/prompt.ts` — delete
  `PROMPT_RULES`; `planConfigExports.ts` — drop the export.
- `lib/engine/nodes/kinds/pipeline/pipelineNode.ts` — `fix_prompt_rules`
  (schema ~93, configFields ~120, fix-run ~593–613, preview ~318–320).

### 4. Frontend (template editor)

- `components/templateEditor/configFieldLogic.ts` — delete `rulesKeyFor`.
- `components/templateEditor/components/configurator/PromptTab.tsx` and
  `fields/DeclarativeConfigFields.tsx` — drop the rulesKey plumbing
  (`rulesKey` computation, `rulesValue`, extra write in `onBodyChange`).
- `components/templateEditor/components/configurator/fields/ConfigFieldRow.tsx`
  — remove the `rulesKeyFor` re-export.
- `components/templateEditor/components/configurator/prompt/PromptSectionField.tsx`
  — drop the `rulesKey` / `rulesValue` / `onRulesChange` props, the "Your
  rules" section, and the `rulesText` term of the assembled preview; update the
  header docs (also resolves the re-export flagged in review-task 54).
- Delete `components/templateEditor/components/configurator/prompt/RulesListEditor.tsx`
  (sole consumer was PromptSectionField; also moots the index-key issue in
  review-task 39).

### 5. Tests

- `lib/engine/prompts/promptAssembly.test.ts` — remove the userRules cases
  (keep a body/locked-block ordering test if one depends on the rules slot).
- `lib/engine/prompts/promptPreview.test.ts` — the CR-049 branch-scoped plan
  describe also asserts `rulesKey === "fix_prompt_rules"`; keep the
  branch-scoping assertions, drop the rulesKey ones.
- `lib/engine/nodes/chatFirstTurn.test.ts` — remove the `prompt_rules` config
  fixture (~427).
- `lib/engine/nodes/kinds/plan/planNode.test.ts` — remove the `promptRules`
  job option (456–477), the `RULES` case (~619), and the empty-rules config
  (~715).

### 6. Docs

- `docs/architecture/build-node.md` (~135), `review-node.md` (~116),
  `resolve-node.md` (~118), `pipeline-node.md` (~174),
  `plan-unified-turns.md` (~39) — drop the knob mentions.
- `docs/make-agentic-node-consitent.md` (~98) — the rules-editing note is
  resolved by this removal.
- `docs/review-tasks/28-prompt-preview-parity.md` / `docs/code-review.md` —
  historical logs; leave as-is and note the resolution in the PR description.
  This removal also closes review-task CR "apply `prompt_rules` or remove the
  knob" for `StepBuildNode` (the inherited dead knob disappears).

### 7. Verification (definition of done)

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- `grep -r "prompt_rules\|fix_prompt_rules\|userRules\|rulesKey\|previewRules"`
  is clean outside `docs/code-review.md` and `docs/review-tasks/`.
- Manually check the settings prompt-template page (body editor only) and the
  template editor Prompt tab still render; run one demo seed (non-reset) and a
  build/plan preview to confirm assembly output has no empty-gap changes when
  no rules knob is set (byte-identical `final` for rule-less nodes by
  construction).

## Deliberately out of scope

- No replacement "rules" UI or enforcement mechanism.
- No DB/seed migration for inert leftover values.
- No touching `prompt_body` / fix-prompt bodies or the locked engine blocks —
  only the user-rules slot goes.
