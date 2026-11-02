# Task 54: Feature folder layout and file naming

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 52: Shared UI components and one `cn()`](52-shared-ui-components.md)
- **Findings:** CR-229, CR-230, CR-239
- **Effort:** L

## Goal

Single-consumer hooks live in shared `hooks/` with kebab-case names that conflict with AGENTS.md section 2.9, and several files are oversized or export multiple components. Use `components/flows/components/plan/` as the reference layout.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-229 [Low] Single-consumer hooks live in shared `hooks/` instead of their feature folders

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** hooks/use-agent-status.ts; hooks/use-artifact-fetcher.ts; hooks/use-flow-comments.ts; hooks/use-graph-def.ts; hooks/use-model-catalog.ts; hooks/use-flow-prompt.ts
- **What to do:** These six hooks still each have exactly one consuming feature (flows: agent-status, artifact-fetcher, flow-comments, graph-def; chat: model-catalog, flow-prompt). `use-flow-chat` now has consumers in both chat and the flows plan feature, so it legitimately stays shared. Fix: move the six into `components/flows/hooks/` and `components/chat/hooks/`, renaming to the camelCase `useThing.ts` convention that AGENTS.md §2.9 now requires.
- **Fix after:** CR-161 ([Task 04](04-client-server-boundaries.md))

### CR-230 [Low] Oversized files and multiple exported components per file

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** components/flows/panels/ReviewView.tsx:38,66,177,196,229 (248 lines); components/flows/FlowStatus.tsx:9-77; components/flows/panels/ArtifactViews.tsx:19,49,102; components/chat/ModelSelector.tsx:25-28; components/chat/prompt-modal/PromptModal.tsx (205 lines)
- **What to do:** PlanView (100 lines), FlowCockpit (115) and use-flow-prompt (186) have been split down. Still open: ReviewView mixes `buildThreads` with three internal components, FlowStatus exports five items, ArtifactViews exports three components, and ModelSelector still exports the `useModels` hook. PromptModal is borderline at 205 lines. Fix: extract `buildThreads` and the thread components, split FlowStatus and ArtifactViews one component per file, and move `useModels` into the hook module.

### CR-239 [Low] Oversized files and files exporting multiple components

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** components/builder/hooks/use-editor-actions.ts (447 lines), components/template-editor/variables.ts (417), components/template-editor/WebhookPayloadDialog.tsx (403, no "use client"), components/builder/EditorPage.tsx (301), components/template-editor/types.ts (232), components/templates/TemplateGallery.tsx (231), components/template-editor/NodeConfigurator.tsx:25-26 (229), components/template-editor/ConfigFieldRow.tsx (211), components/builder/EditorNodeDrawer.tsx:138, components/builder/EditorEdgeDrawer.tsx:25, components/template-editor/components/EdgeKindField.tsx:13, components/template-editor/PromptSectionField.tsx:45
- **What to do:** Every listed file still has the same line count. `SheetFooterHelper` is still a second export of EditorNodeDrawer and is consumed by EditorEdgeDrawer. NodeConfigurator still re-exports `SelectOption` and `StartContractEditor`, EdgeKindField imports `SelectOption` through it, and PromptSectionField re-exports `RulesListEditor`. Split use-editor-actions and WebhookPayloadDialog (and add "use client" to the dialog), move `SheetFooterHelper` to components/shared/, and replace the re-exports with direct imports.

**PR note (CR-239 remainder):** `use-editor-actions` is split into `editor-actions/*`; `WebhookPayloadDialog` has `"use client"` and `webhook-payload-dialog/webhookPayloadUtils.ts`; `SheetFooterHelper` and re-export cleanups are done. Still oversized without further splits: `variables.ts`, `EditorPage.tsx`, `types.ts`, `TemplateGallery.tsx`, `NodeConfigurator.tsx`, `ConfigFieldRow.tsx`.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
