# Task 35: Cockpit panels: per-node state and render-time bugs

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 15: Every mutation reports pending and error](15-frontend-mutation-conventions.md)
- **Findings:** CR-028, CR-124, CR-122, CR-123, CR-127, CR-130, CR-235
- **Effort:** M

## Goal

Panels are not keyed by node, so local state (including a `choose_node` payload and the chat draft) leaks between nodes. Proposals that arrive by polling are never preselected, artifact versions can't be viewed, and two components read browser-only values during render.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-028 [High] NodePanel isn't keyed by node, so panel-local state leaks between nodes (including a wrong `choose_node` payload)

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/NodePanel.tsx:53-60 (Panel / PanelShell rendered without key); components/flows/cockpit/FlowCockpit.tsx:111; leaking state: components/flows/panels/DecisionView.tsx:30-31,66, AgentView.tsx:29-30, ArtifactViews.tsx:31,111
- **What to do:** The panel is still rendered as `<Panel />` with no `key`, so switching between two nodes served by the same component keeps the previous node's `useState`. For example, DecisionView posts node A's selection as `choose_node` for node B. Render `<Panel key={node.node_key} />` (and key the fallback `PanelShell`), or key `<NodePanel>` in the cockpit.

### CR-124 [Medium] ChatPanel state carries over between nodes (draft, refine toggle, prompt box, send error)

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/NodePanel.tsx:46-70, components/flows/panels/NodeChat.tsx:17-29, components/chat/components/chatComposerForm/ChatComposerForm.tsx:80
- **What to do:** The refine toggle and `NodePromptBox` are gone, and the chat panel no longer renders the send error. But the rail and panel are still not keyed by node: `ChatComposerForm`'s `useState(initialDraft)` draft survives a switch between two nodes using the same `NodeChat`, and is then sent to the new node. Panel-local state (for example `DecisionView` `sel` and `AgentView` dialogs) also carries over between same-kind nodes. Fix: render `<NodePanel key={node.node_key} …>` in `FlowCockpit`, or key `<Panel/>` and `<Chat/>` inside `NodePanel`.

### CR-122 [Medium] DecisionView seeds its pick from props once, so a proposal that arrives later is never preselected

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/DecisionView.tsx:28-30, components/flows/panels/DecisionView.tsx:39-44, components/flows/panels/DecisionView.tsx:60-69
- **What to do:** `useState<string[]>(proposed)` still captures `out.chosen` only at mount, so a proposal that arrives by polling is never preselected and the "Confirm" button never shows. Fix: hold only the user's override (`useState<string[] | null>(null)`) and derive `override ?? proposed` during render.

### CR-123 [Medium] AgentView version tabs do nothing when clicked

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/AgentView.tsx:37-38, components/flows/panels/AgentView.tsx:92-102
- **What to do:** `VersionTabs` still gets `sel={latest.id}` and `onSel={() => {}}`, and the loader always renders `latest`, so earlier versions can't be viewed. Fix: add `selId` state with `current = mdArts.find(a => a.id === selId) ?? latest` (the same as `GenericArtifact`), or reuse `GenericArtifact` with a custom renderer.

### CR-127 [Medium] Hydration mismatches: `window.location.origin` and `Date.now()`/`toLocaleTimeString` in SSR'd panel render

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/PanelShell.tsx:106-125, components/flows/panels/ResolveView.tsx:21-26
- **What to do:** `WaitBanner` still reads `window.location.origin` during render (empty on the server), and `ResolveView` still calls `Date.now()` and `toLocaleTimeString` during render. The cockpit is server-rendered with `initialFlow`, so both cause hydration mismatches. Fix: render a relative `/api/hooks/<id>` path and build the absolute URL only in the copy handler; format the time client-side after mount (a `useSyncExternalStore`/`useIsClient` hook).

### CR-130 [Medium] CostChip shows sub-cent run costs 100× too high

- **Status:** Fixed (Task 35)
- **Type:** Bug
- **Effort:** S
- **Where:** components/flows/panels/CostChip.tsx:33-36, components/flows/panels/CostChip.tsx:19-31
- **What to do:** `fmtCents` still prints `$${c.toFixed(3)}` for `0 < c < 1` cents, so 0.4¢ shows as "$0.400", in both the chip and the per-run tooltip rows. Fix: `$${(c / 100).toFixed(c < 1 ? 4 : 2)}`, or reuse the shared cost, duration and token formatters instead of the local `fmtDur`, `fmtTok` and `fmtCents`.

### CR-235 [Low] Cockpit selection reads a ref during render to decide what's shown

- **Status:** Fixed (Task 35)
- **Type:** Code quality
- **Effort:** S
- **Where:** components/flows/cockpit/FlowCockpit.tsx:52-58
- **What to do:** `userSelected` ref is still read during render (`resolvedSelectedKey = userSelected.current ? selected : flow.current_node ?? ''`) and set inside `onSelect`. Derive `resolvedSelectedKey = selected || flow.current_node || ''`, drop the ref, and pass `setSelected` as `onSelect`.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
