# Task 36: Cockpit accessibility, keys and rendering cost

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 35: Cockpit panels: per-node state and render-time bugs](35-cockpit-panel-state.md)
- **Findings:** CR-131, CR-128, CR-233, CR-234, CR-236, CR-227
- **Effort:** M

## Goal

Clickable `div`s and nested buttons in the cockpit, index keys that remount rows, a dagre layout on every render, and a full page reload on sub-flow navigation.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-131 [Medium] Clickable non-button elements without keyboard support (graph node cards, decision choices, variable chips)

- **Status:** Open
- **Type:** Accessibility
- **Effort:** S
- **Where:** components/flows/workflow-graph/NodeCard.tsx:60-71, components/flows/panels/DecisionView.tsx:137-140, components/chat/prompt-modal/PromptEditorSection.tsx:32-38
- **What to do:** Graph node selection (`<div onClick>`), decision choice picking (`<Card onClick>`) and variable insertion (`<Badge onClick>`) still have no role, `tabIndex`, key handling or label. Fix: render them as `<button type="button">` (or use `render={<button/>}` on Card and Badge) with `aria-pressed` and `aria-label`.

### CR-128 [Medium] Invalid DOM nesting (`<ul>` inside `<p>`, button inside button, interactive inside `role="button"`)

- **Status:** Partly fixed
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/components/plan/components/subPlanSection/SubPlanCard.tsx:36-80, components/flows/components/plan/components/masterPlanSection/MasterPlanSection.tsx:71-76
- **What to do:** The `<ul>`-in-`<p>` (`FailureAlert` was rewritten), `NodePromptBox` and `ContextPicker` cases are gone. `SubPlanCard` still nests two Base UI `TooltipTrigger` buttons inside its toggle `<button>`, and `MasterPlanSection` now wraps a `<button>` inside a `TooltipTrigger` without `render`, which is button-in-button. Fix: use `render={<span/>}` or `render={<Badge/>}` on triggers inside the toggle, and `render={<button type="button" aria-label=…/>}` in `MasterPlanSection`.

### CR-233 [Low] WorkflowGraph re-runs the dagre layout on every render (every poll and selection click)

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** components/flows/workflow-graph/WorkflowGraph.tsx:37-58; components/flows/workflow-graph/graph-layout.ts:34-37; components/flows/workflow-graph/GraphEdges.tsx:51-52,84,92
- **What to do:** `layout(keys, edges)` still rebuilds the dagre graph on every render (every poll and selection click), `keys.includes` inside the edge loop is O(n²), and `specOf` does a linear `find` per edge, twice. React Compiler is not enabled. Fix: `useMemo` the layout on a stable signature placed before the early returns (hooks order), use a `Set` for keys, and pre-index `edgeSpecs`.

### CR-234 [Low] Sub-flow navigation uses a raw `<a href>`, causing a full page reload and dropping the query cache

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** components/flows/panels/FanoutStepList.tsx:161-169
- **What to do:** "Open sub-flow" is still a raw `<a href>` to an internal route, so each click does a full reload and drops the TanStack cache. Fix: use `next/link` (`<Link href=…>` or `Button render={<Link/>}` as FlowHeader does).

### CR-236 [Low] Inline callbacks created inside `.map()` bodies

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** components/flows/panels/StartView.tsx:87, components/flows/panels/BuildView.tsx:165, components/flows/panels/DecisionView.tsx:94, components/flows/panels/FanoutStepList.tsx:116-172 (closures at 143,148,157), components/flows/panels/ArtifactViews.tsx:76, components/flows/components/plan/components/PlanApproveFooter.tsx:74, components/chat/prompt-modal/PromptEditorSection.tsx:35
- **What to do:** Closures are still created inside `.map()` bodies; the plan footer moved to components/flows/components/plan/components/ but kept the pattern. FanoutStepList's ~55-line inline step card is the main target. Extract `FanoutStepCard` / `BranchMrRow` (and similar) rows that take primitives and a stable `(id) => void`, as `PlanStepItem` / `PlanStepDraftRow` already do.

### CR-227 [Low] Index-based React keys remount rows: run sections lose expand state, and draft rows shift focus

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** components/chat/ChatFeed.tsx:72-83; components/chat/RunSectionRow.tsx:61-63; components/flows/components/plan/components/planSteps/PlanSteps.tsx:136-144
- **What to do:** Run-section keys are still index-qualified (`r${section.key}#${i}`), feed items still use `key={i}`, and plan-step drafts still use `key={i}` with remove-by-index. Rows therefore remount and lose expand state when earlier rows shift. Fix: key sections by a stable identity (section key plus first event id), feed items by event or tool id, and drafts by a client id created in the draft factory.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
