# Plan: Migrate custom components to AI Elements + remove Activity tab

Two goals:

1. **Adopt Vercel AI Elements** (`components/ai-elements/*`) in place of hand-rolled chat/agent UI primitives.
2. **Single unified panel**: merge the Activity feed into the Chat panel and delete the Activity tab.

Current state: no AI SDK / ai-elements anywhere; Next.js 15 + React 19 + Tailwind v4 + radix `^1.8.1`; poll-based chat (4s) and events (3s); right rail = `Chat` / `Activity` tabs in `app/flows/[id]/page.tsx`.

---

## Key design decisions (recommended)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Data transport | **Keep the poll-based model** (phase 1). AI Elements are presentational — feed polled history as static content. Optional later phase: swap `/events` polling for SSE `useChat`-compatible transport. Don't couple the UI migration to a transport rewrite. |
| D2 | Timeline merge | **Interleave** chat messages and activity groups into one thread sorted by timestamp, inside a single `Conversation`. Runs render as collapsible blocks between messages. |
| D3 | Scope reconciliation | Chat is scoped by `node_key` (`messages.node_key`), events by run/node-id. The unified panel keeps the existing `nodeFilter` prop — both sources filtered to the selected node. |
| D4 | Filters | Keep the filter chips (Thinking / Tools / Status) as a small custom row above the `Conversation` — ai-elements has no filter concept. |

---

## Component mapping

| Current | Location | → AI Elements replacement |
|---|---|---|
| Chat bubbles + avatars | `components/ChatPanel.tsx` | `Conversation` + `Message` + `MessageContent` |
| Enter-to-send Textarea + Send button | `components/ChatPanel.tsx` | `PromptInput` (+ `PromptInputTextarea`, `PromptInputSubmit`) |
| "Refine plan" toggle | `components/ChatPanel.tsx` | `PromptInputToolbar` slot with existing `ui/switch` |
| "Agent is working…" placeholder | `components/ChatPanel.tsx` | `Loader` inside a pending `Message` |
| Markdown renderer | `components/Markdown.tsx` | `Response` (Streamdown) with custom mermaid `pre` override |
| Thinking groups | `components/ActivityFeed.tsx` (GroupCard thinking) | `Reasoning` (collapsible, is-streaming support) |
| Assistant text groups | `components/ActivityFeed.tsx` | `Message` + `Response` |
| Tool start/finish pairs | `components/ActivityFeed.tsx` (ToolCard) | `Tool` / `ToolHeader` / `ToolContent` — keep custom `summarizeArgs` + icon mapping as the tool's input/status props |
| Pulsing active indicators | `components/ActivityFeed.tsx` | `Loader` |
| Run meta (duration · tokens · cost) | `components/ActivityFeed.tsx` (RunBlock footer) | Keep custom (reuse `fmt*` helpers) — `Actions`/`MessageActions` don't fit; plain footer row |
| Mermaid renderer | `components/Mermaid.tsx` | **Keep** — mounted via Streamdown code-component override (Streamdown has no mermaid) |
| Plan steps, DiffView, ReviewView threads, WorkflowGraph, PromptModal, ModelSelect, generics | n/a | **Keep custom** — no ai-elements equivalent |

Should be able to delete after migration: `components/Markdown.tsx`, `components/ActivityFeed.tsx`, `components/ui/tabs.tsx` (only consumer is the right-rail Chat/Activity tabs).

---

## Phases

### Phase 1 — Install & theme AI Elements (setup)
1. Add `components.json` (shadcn config, `components/ui` + `components/ai-elements` aliases), then:
   `npx shadcn@latest add "https://ai-sdk.dev/elements/all"` (or individually: `conversation`, `message`, `response`, `prompt-input`, `reasoning`, `tool`, `loader`, `code-block`, `actions`).
2. New deps: `streamdown`, `use-stick-to-bottom`, `shiki` (transitively required by Response). `react-markdown`/`remark-gfm` stay until full cleanup.
3. Map ai-elements CSS variables (`--ai-*` tokens) onto the app's dark palette in `app/globals.css` (`--bg/--panel/--accent` system) — dark-only app, so adjust the generated styles directly.

**Exit check:** components render in isolation (e.g. a throwaway route) with correct theming.

### Phase 2 — `Response` replaces `Markdown.tsx` (low risk, used everywhere)
1. Create mermaid-aware code-block override: wrap/replace Streamdown's code component so ```mermaid blocks still route to `components/Mermaid.tsx`. Preserve `target=_blank` link behavior (Streamdown respects hyperlinks; verify).
2. Consumers to migrate (4): `ChatPanel.tsx`, `ActivityFeed.tsx`, `PlanView.tsx` (lines 348, 384), `ReviewView.tsx`.
3. Delete `components/Markdown.tsx`, drop `react-markdown` at the end.

**Gotcha:** this is the one change that touches ActivityFeed, so do it *before* Phase 3 rewrites ActivityFeed's consumers.

### Phase 3 — Unified chat panel (the core)
Rebuild `components/ChatPanel.tsx` on AI Elements:

1. **Merge data sources in one timeline**: existing messages (via current `GET /api/flows/[id]/chat`) + grouped events (`lib/groupEvents.ts` output, already passed as props from `page.tsx`). Sort by createdAt → render as:
   - user/assistant chat rows → `Message` (bubble), assistant body via `Response`
   - thinking groups → `Reasoning`
   - tool pairs → `Tool` (collapsible args/result; keep `summarizeArgs`/duration formatting)
   - status groups → small inline status row (`Loader` + text)
   - run sections → collapsible wrapper (radix Collapsible or a light custom `RunBlock`) with duration · tokens · cost footer
   - events without a corresponding chat message (lifecycle/error/mr_failed) → compact system rows
2. **Input area**: `PromptInput` — keep enter-to-send, "Refine plan" switch in `PromptInputToolbar`, disabled state during runs.
3. **Pending state**: `Loader` message instead of the custom spinner block (`ChatPanel.tsx:97–106`).
4. **Auto-scroll**: drop the manual scroll effect (line 38); use `Conversation`'s built-in stick-to-bottom.
5. **Filters**: keep `FilterBar` chips as a custom row; hide thinking/status rows by default (same defaults as today).
6. Props/contracts unchanged (`messages`, `events`, `nodeKeysByNodeId`, `nodeFilter`, `onSend`) → `page.tsx` wiring is untouched in this phase.

### Phase 4 — Remove the Activity tab
1. `app/flows/[id]/page.tsx` (lines 148–173):
   - Remove `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` import + usage.
   - Right `aside` becomes a single full-height `ChatPanel` (the panel now contains everything).
   - Drop remaining `ActivityFeed` usage and its props plumbing.
2. Delete `components/ActivityFeed.tsx`, `components/ui/tabs.tsx`.
3. Move `fmtDuration` / `fmtTokens` / `fmtCost` from `ActivityFeed.tsx` to `lib/format.ts` (they're reused by the new run/tool blocks).
4. Keep `lib/groupEvents.ts` unchanged (still the grouping engine).

### Phase 5 — Modal → shadcn Dialog
`components/ui/modal.tsx` is the only hand-rolled non-radix primitive: manual escape-key handler (lines 21–28), backdrop-click close, no focus trap, no portal, no scroll lock. Single consumer: `components/PromptModal.tsx` (line 4) — used for plan generate / refine / resolve triggers (also opened from `PlanView.tsx`).

1. `npx shadcn@latest add dialog` → `components/ui/dialog.tsx`.
2. Normalize Radix import to the project's unified-barrel style (`import { Dialog as DialogPrimitive } from "radix-ui"`) to match the rest of `components/ui/*` (button, select, switch, etc.).
3. Theme `DialogContent` to the app palette: `bg-panel border-border rounded-[14px]`, header/footer/scroll layout mirroring the current Modal so sizing (`max-w-[720px] max-h-[85vh]`, scrollable body) is preserved.
4. Reimplement `components/ui/modal.tsx` as a thin wrapper over shadcn Dialog **keeping its existing API** (`open`, `onClose`, `title`, `className`, `children`) — returns `null` when closed, renders `DialogContent` + `DialogTitle` + `DialogDescription` (visually hidden where needed) for a11y. This makes Phase 5 zero-touch for `PromptModal.tsx`; refactor PromptModal to use `Dialog` directly as optional follow-up cleanup.
   - Free wins from radix: focus trap, portal/overlay stacking, scroll lock, Escape + outside-click already handled.
5. Verify: Warn-First (`model-warning` prompt) and plan modal flows in `/` home (new flow) and within `PlanView` steps.

### Phase 6 — Cleanup & verification
- Remove dead deps (`react-markdown`, `remark-gfm` if nothing else uses them), dead files, unused CSS.
- Manual test checklist in `app/flows/[id]`:
  - [ ] per-node chat send/receive + pending loader + auto-scroll
  - [ ] live run: thinking collapses open/closed, tool cards show args/result/duration
  - [ ] run summaries (duration · tokens · cost, "est." flag)
  - [ ] filter chips defaults (thinking+status off, tools on)
  - [ ] mermaid blocks render; code blocks highlight; links open in new tab
  - [ ] "Refine plan" toggle + plan-only run path
  - [ ] error / mr_failed events visible as system rows
  - [ ] `/` home flow and `/settings` unaffected

---

## Risks / gotchas
- **Mermaid**: Streamdown has no mermaid support — the custom code override in Phase 2 is mandatory, not optional.
- **Polling vs streaming assumptions**: `Conversation`/`Reasoning` are built around `useChat` streaming. With polling, `isStreaming` props are just set from "run active" state — fine, but don't expect token-by-token animation without D1's later SSE phase.
- **Two scopes in one timeline**: chat rows have no `run_id`; don't try to nest chat messages inside run blocks — interleave by timestamp instead (D2).
- **Theming**: ai-elements ships light/dark tokens assuming a Tailwind v4 `@theme` setup; app uses custom tokens in `globals.css` — reconcile in Phase 1 before component work.
- **Radix package style**: app uses the unified `radix-ui` barrel while generated components may import `@radix-ui/react-*` individually — normalize to the barrel or install individual packages as generated.

## Suggested order of work
Phase 1 → 2 → 3 → 4 → 5 → 6, with a working tree review after each phase. Phase 2 is independently shippable (markdown swap), Phase 3+4 go together (panel merge + tab removal). Phase 5 (modal) is independent of Phases 3–4 and can run any time after Phase 1.

---

## Implementation notes (as built, 2026-10-22)

- **Registry moved**: the `https://ai-sdk.dev/elements/*` URLs are gone; the registry now lives at
  `https://registry.ai-sdk.dev/{component}.json` (`npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json`, etc.).
  Added: `conversation`, `message`, `prompt-input`, `reasoning`, `tool`, `loader` (+ shadcn `dialog` and its
  dependency chain: collapsible, dropdown-menu, hover-card, command, button-group, input-group, separator).
- **`response.tsx`**: the registry no longer ships a standalone `Response`; it's folded into `MessageResponse`
  (Streamdown) inside `message.tsx`. We added `components/ai-elements/response.tsx` — a Streamdown wrapper with
  plugin singletons — to keep the plan's `Response` contract:
  - syntax highlighting via `@streamdown/code` (Streamdown core has no shiki in 2.x)
  - **mermaid via `@streamdown/mermaid`** — Streamdown *does* support mermaid natively now, so the planned custom
    `pre` override + `components/Mermaid.tsx` were dropped; the mermaid theme variables were carried over.
- **Layouts**: `components.tsx` themes were normalized onto the app palette by adding shadcn token aliases in
  `app/globals.css` (`--color-foreground/background/secondary/muted-foreground/popover/…`) rather than editing
  every generated class. `MessageContent` was restyled directly for the app's bubble look.
- **ChatPanel contract drift from the plan**: the old ChatPanel owned its own polling (`flowId`, `nodeKey`,
  `busy`, `canRefine`); that's kept and `events` + `nodeKeysByNodeId` props were added — `page.tsx` wiring is a
  one-line change, not the plan's hypothetical `messages`/`onSend` list.
- **Flow-level events** (`node_id = null`: MR pushes, pipeline results, checklist edits) are rendered as
  standalone system rows on every node — without this they'd vanish under the per-node `nodeFilter` (D3).
- **Tooltips**: `ui/tooltip.tsx`'s one-shot `Tooltip` was extended so it also works as a bare Radix Root (dual
  mode); `Button` gained `outline` / `icon-sm` / `icon-xs` variants for the generated components.
- **Verified** (seeded flow + headless Chromium): bubbles, pending/loader row, chips defaults (thinking/status
  off, tools on), collapsible run blocks with duration · tokens · cost, thinking `Reasoning` toggle, tool
  args/result blocks, `@streamdown/mermaid` SVG diagrams in chat, shiki-highlighted code, Streamdown link
  (Copy/Open — hardened links render as a button that opens a new tab, not an `<a target=_blank>`), refine
  toggle, plan/Edit-prompt modal via the Dialog-backed `Modal` (Escape + overlay close), `/` + `/settings` fine.
