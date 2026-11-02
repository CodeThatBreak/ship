# Task 15: Every mutation reports pending and error

- **Phase:** Phase 1: Shared foundations
- **Depends on:** [Task 13: One queryFn per query key](13-frontend-query-ownership.md)
- **Findings:** CR-027, CR-126, CR-129, CR-271, CR-237
- **Effort:** M

## Goal

Cockpit actions, chat sends, flow delete and layout autosave either swallow errors or show nothing while pending. Route them through `useMutation` hooks that expose `isPending`/`error`, and invalidate every affected key from one place.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-027 [High] Cockpit `action()` swallows HTTP errors, gives no feedback, and has no pending/double-submit guard

- **Status:** Fixed
- **Type:** Gap
- **Effort:** M
- **Where:** components/flows/cockpit/FlowCockpit.tsx:65-72; components/flows/mutations/useFlowMutation.ts:13-24; callers: components/flows/panels/PanelShell.tsx:69,80, AgentView.tsx:57,62,139, DecisionView.tsx:61,66, BuildView.tsx:69-70, FanoutStepList.tsx:143,149,157, ReviewView.tsx:101,105,167, ResolveView.tsx:38,64, PipelineView.tsx:37,64, ScriptView.tsx:41, HttpView.tsx:38, StartView.tsx:47
- **What to do:** Fixed part: `action()` now goes through `postJson`, which throws on `!res.ok`, so failures are no longer treated as success, and the plan panel uses a `useMutation` wrapper (`useFlowMutation`). Remaining: cockpit panels still call the raw callback with no `useMutation`, no pending/disabled state and no visible error, and most callers don't await or catch, so a 400 becomes an unhandled rejection with no feedback. Route every panel through `useFlowMutation`, expose `isPending`/`error` from it, render an alert with retry in `PanelShell`, and disable action buttons while pending.

### CR-126 [Medium] Prompt previews go stale after a node-config save, and the modal never re-seeds from a fresh refetch

- **Status:** Fixed
- **Type:** Bug
- **Effort:** M
- **Where:** components/flows/panels/AgentView.tsx:136-141, components/flows/cockpit/FlowCockpit.tsx:65-72, hooks/use-flow-prompt.ts:100-116, hooks/use-flow-prompt.ts:153-160
- **What to do:** AgentView's Configure save still goes through the cockpit `action`, which only invalidates `flows.detail`, not `promptScope`, `prompts` or `nodePrompt`. `useFlowPrompt` still seeds once per open session from cached data through an effect, so a fresher refetch is ignored. Even the rules save only invalidates `promptScope`, not `prompts` or `nodePrompt`. Fix: invalidate all three prompt key families after `set_node_config`, and derive `edited ?? baseQuery.data.prompt` during render instead of seeding from an effect.
- **Fix after:** CR-027 (this task)

### CR-129 [Medium] Flow delete failure is hidden behind the still-open dialog, and "Retry" doesn't retry the delete

- **Status:** Fixed
- **Type:** Gap
- **Effort:** S
- **Where:** components/flows/FlowsView.tsx:41-54, components/flows/FlowsView.tsx:86-104, components/flows/FlowsView.tsx:166-171, components/flows/DeleteFlowDialog.tsx:44-51
- **What to do:** A failed delete still leaves the dialog open with no message; the error renders in the page `<Alert>` behind the overlay, and that Alert's "Retry" resets the mutation and refetches the list instead of retrying the delete. Fix: pass `removeFlow.error?.message` into `DeleteFlowDialog` and render it there; keep the page Alert for list errors only; call `removeFlow.reset()` on dialog close.

### CR-271 [Medium] Chat send failures are never shown to the user

- **Status:** Fixed
- **Type:** Gap
- **Effort:** S
- **Where:** components/chat/ChatPanel.tsx:117-123, components/chat/ChatPanel.tsx:195-200, components/chat/hooks/useChatComposer.ts:61-65, components/chat/components/chatComposerForm/ChatComposerForm.tsx:143-151, components/flows/panels/NodeChat.tsx:17-29, components/flows/components/plan/PlanNodeChat.tsx:46-62
- **What to do:** Chat send failures are invisible. `useChatComposer` returns `error`, but `ChatPanel` only takes `sendMessageMutation` and `isPending`; neither `NodeChat` nor `PlanNodeChat` passes `sendError`; and `ChatComposerForm` swallows the rejection (`.catch(() => {})`). A failed `POST /chat` (run start rejected, 4xx or 5xx) therefore just re-enables the textarea with no message or retry. Fix: have `ChatPanel` render `useChatComposer().error?.message` as the send error (with `reset()` on the next edit), and drop the now-unused `sendError` prop.

### CR-237 [Low] Layout autosave shows "saved" on HTTP errors

- **Status:** Fixed
- **Type:** Bug
- **Effort:** S
- **Where:** components/template-editor/hooks/use-node-positions.ts:17,61-67
- **What to do:** The positions PATCH still does `.then(() => setLayoutSync("saved"))` regardless of `res.ok`, and network errors fall back silently to "idle". Add an "error" `LayoutSync` state set when `!r.ok` or on catch, render it in `EditorHeader`, and preferably move the PATCH to a `useMutation`.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
