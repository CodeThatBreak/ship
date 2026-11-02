# Task 55: Frontend domain constants and single-source types

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 54: Feature folder layout and file naming](54-feature-layout-and-naming.md)
- **Findings:** CR-228, CR-238, CR-246, CR-247, CR-155, CR-232, CR-253
- **Effort:** M

## Goal

Action names, node kinds, event types, execution modes and filter values are raw literals. Client types like `Repo` are re-declared in provider files and drift from their sources.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-228 [Low] Domain strings (actions, node kinds/types, event types, merge statuses, modes) hardcoded instead of constants

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** components/flows/panels/AgentView.tsx:57,62; DecisionView.tsx:61; ScriptView.tsx:41; HttpView.tsx:38; StartView.tsx:47; FanoutStepList.tsx:21,120,136,143,149,157; BuildView.tsx:54,64; FlowHeader.tsx:57; StatusBar.tsx:9,70; DeclarativeView.tsx:20; GraphEdges.tsx:46; components/chat/EventRow.tsx:18; components/chat/FlowEventRow.tsx:20; components/chat/RunSectionRow.tsx:73
- **What to do:** `FLOW_STATUS`/`STATUS_VARIANT` are now used in the panels, and `EXECUTION_MODE_LOCAL` is used in FlowColumns, FlowsView and NodePanel. `FLOW_ACTION` exists but has only `RUN_NODE` and is used nowhere. Panels still type `"approve_node"`, `"run_node"`, `"*_fanout_step"`, `"mr_failed"`, `"lifecycle"`, `"conflict"`, `"decision"` and `"local"` (FlowHeader, StatusBar) inline. Fix: complete `FLOW_ACTION`, add `FLOW_EVENT_TYPE`/`MERGE_STATUS`/`NODE_KIND`, use them, and reuse `EXECUTION_MODE_LOCAL`.

### CR-238 [Low] Duplicated domain magic strings and kind unions

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** components/template-editor/components/BuilderFlow.tsx:32, components/template-editor/WebhookPayloadDialog.tsx:37, components/template-editor/hooks/use-palette-catalog.ts:15,20,64, components/template-editor/hooks/use-configurator-tabs.ts:26, components/template-editor/types.ts:162, components/template-editor/NodePalette.tsx:122, components/builder/hooks/use-editor-actions.ts:35,223,347, components/builder/EditorCanvas.tsx:46, components/template-editor/boilerplate.ts:12, components/templates/constants.ts:8,16, components/template-editor/components/ConfigTab.tsx:31, components/template-editor/DeclarativeConfigFields.tsx:97
- **What to do:** `START_NODE_TEMPLATE_ID` is still redeclared locally in BuilderFlow and WebhookPayloadDialog, and `"nt_start"` is inlined twice more, even though draft.ts:32 exports it. `"nt_plan"`, `"start"` and `"decision"` are still raw literals, and the agent/decision/http/script union is declared four times (`DraftKind`, `AuthorKind`, `NodeTemplateKind`, the EditorCanvas inline union). The fanout key set is duplicated in ConfigTab and DeclarativeConfigFields. Add a shared `NODE_KIND` `as const` object, a `NodeKind` type and `BUILTIN_TEMPLATE_ID` constants, then import them everywhere.

### CR-246 [Low] Execution-mode values are raw literals with no shared constant; the `ExecutionMode` name collides

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** types/tasks.ts:10, components/tasks/hooks/use-start-build.ts:27, components/tasks/BuildModal.tsx:163,166, components/settings/general/constants.ts:7-10, components/flows/constants.ts:4, components/flows/components/plan/constants/index.ts:7-11
- **What to do:** `"cloud"` and `"local"` are still compared and rendered as raw literals, and the only constant is still the feature-local `EXECUTION_MODE_LOCAL`. The plan feature's `ExecutionMode` (whole/steps), now in components/flows/components/plan/constants, still collides by name with `types/tasks.ts` `ExecutionMode`. Add constants/execution.ts with `RUN_MODE` and `RunMode`, replace the literals, and rename one of the two types.

### CR-247 [Low] Magic domain strings in tasks filters and integration tabs

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** components/tasks/TasksView.tsx:47,67-79, components/tasks/hooks/use-live-tasks.ts:12,15, components/settings/integrations/GitTab.tsx:28-29,44, components/settings/integrations/TaskTab.tsx:28-29,44, components/settings/integrations/HarnessTab.tsx:71,73, components/settings/general/components/StatusBar.tsx:18-19
- **What to do:** The filter keys and values (assignee, me, any, provider, statusCategory), the hosting values (cloud, custom), the Cursor card id and URL, and StatusBar's `.gitlab` / `.jira` lookups are all still literals, even though `PROVIDER_KIND` exists. Add `TASK_FILTER` / `ASSIGNEE` and `HOSTING` constants, use `PROVIDER_KIND` in StatusBar, and hoist the Cursor card constants.

### CR-155 [Medium] Client types duplicate server/DB shapes and live in a component file instead of `types/`

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** M
- **Where:** components/settings/context.tsx:11-40, components/settings/integrations/types.ts:5-11, types/tasks.ts:20-25, types/template-editor.ts:19-23
- **What to do:** `Repo`, `HostInstanceRow`, `GitHost`, `Harness` and `Settings` are still declared inside the client provider file, with optional fields the API always sends. `HostInstanceRow` still duplicates `InstanceRow`, and `RepoSummary`/`EditorRepoChoice` are hand-written copies. There is no `types/settings.ts` or `types/repos.ts`. Fix: create those two files, derive `Repo` from `RepoRow`, derive the summaries with `Pick`, and delete `HostInstanceRow`.

### CR-232 [Low] Duplicated types and transport helpers drift from their sources

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** components/flows/workflow-graph/NodeCard.tsx:11-17; components/flows/cockpit/fanout-progress.ts:20-26; components/flows/panels/ReviewView.tsx:17-22; hooks/use-flow-comments.ts:8-19; hooks/use-flow-prompt.ts:53-57,138-151; components/flows/panels/CostChip.tsx:19-31
- **What to do:** `FanoutProgress` is still defined twice, and ReviewView still re-declares `Comment` instead of importing `MrComment`. `use-flow-prompt` still hand-rolls `fetch` (the `fetchPromptData` path throws a bare `HTTP <status>` and drops the server's `{ error }`). CostChip still duplicates `fmtDuration`/`fmtTokens` from `lib/format.ts` as `fmtDur`/`fmtTok`. Fix: import the single sources, and use `fetchJson`/`postJson`.

### CR-253 [Low] Task badges: `target="_blank"` without `rel`, and regex if-chains instead of lookup tables

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** components/tasks/TaskBadges.tsx:17-31,34-41,54-78 (also components/flows/panels/BuildView.tsx:155)
- **What to do:** The provider link still has `target="_blank"` with no `rel="noopener noreferrer"`, the same gap exists on the BuildView MR link, and type, status and priority styling are still if/regex ternary chains in a file exporting three components. Add `rel`, move the `[pattern, className]` tables into components/tasks/constants.ts, and split the three badges into separate files.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
