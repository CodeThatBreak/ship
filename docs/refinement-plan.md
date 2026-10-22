# DevFlow Refinement Plan

Date: 2026-10-19 · Status: approved for implementation, phased

## Goals

1. **Configurable node prompts** — every node (plan, build, pipeline_fix, review, resolve) gets an
   editable prompt: an edit modal shows the fully resolved prompt before it's sent and allows
   modifying it; defaults are manageable as templates.
2. **Robust multi-branch plans + sub-agents** — the plan node can decompose work into multiple
   branches; each branch builds independently and gets **its own MR, reviewed independently**.
   Sub-agent execution is available as an option for **both** the planning step (fan-out
   exploration) and the build step (parallel per-branch agents).
3. **Cost analysis per run** — token usage and dollar cost captured for every agent run, rolled up
   per node and per flow.
4. **Activity feed fixes** — thinking streams merge into a single entry instead of one row per
   delta; tool calls are clubbed into one row per invocation showing which tool ran, its status,
   and its args.

## Live API verification (2026-10-19)

- Direct call with the project `.env` key (`GET /v1/agents`) → `401 "You are not authorized to use
  cloud agents in this team"`. Key is valid but **cloud agents are not enabled for this team** —
  cloud-mode features below can't be exercised until that's resolved. Local mode is unaffected.
- From the official Cloud Agents API docs (cursor.com/docs/cloud-agent/api):
  - **`GET /v1/agents/{id}/usage`** returns per-run token usage (`inputTokens`, `outputTokens`,
    `cacheWriteTokens`, `cacheReadTokens`, `totalTokens`). The official TS SDK type `V1RunUsage`
    also has optional **`cost: { rawCostCents, chargedCents }`** — real dollar cost from Cursor,
    no pricing table needed when present.
  - Cloud `tool_call` SSE events carry a stable **`callId`** (plus `args`, `result`, `truncated`
    flags) — exact tool-call pairing in the activity feed.
  - `POST /v1/agents` supports up to 20 **`customSubagents`** (`{name, description, prompt,
    model}`) — native sub-agent delegation for plan/build fan-out.
  - `createAgent` accepts a client-supplied `agentId` (idempotent create, `409
    agent_id_conflict` on replay); concurrent runs on one agent are guarded by `409 agent_busy`.

## Architectural constraints (from code review)

- **Events are append-only.** The events API polls with `WHERE id > ?` (monotonic ids), so
  thinking-merge must NOT UPDATE existing rows — coalesce server-side before insert, and group
  client-side at render.
- **Prompts are hardcoded** in `lib/engine/nodes.ts` (inline string building per executor).
- **Single-branch assumption:** `flows.mr_branch/mr_url/mr_iid` are singletons; reconcile, poller,
  review, resolve, and webhook matching are all keyed to them.
- **`executeRun()` in `nodes.ts` is the single choke point** for both cloud and local runs — ideal
  place for cost capture and stream throttling.
- Settings storage exists (`settings` key/value JSON table) — reuse for prompt templates + pricing.
- No modal component exists in `components/ui/` yet — one must be built.

---

## Phase 1 — Activity feed overhaul + cost capture

*Low risk. No engine behavior change. Validate against local mode (cloud `/usage` untestable until
the team enables cloud agents).*

### 1A. Cost & usage per run

- **Schema** (idempotent migration in `db/migrate()`, same pattern as `session_id`):
  `runs` += `model TEXT`, `input_tokens INTEGER`, `output_tokens INTEGER`,
  `cache_read_tokens INTEGER`, `cache_write_tokens INTEGER`, `duration_ms INTEGER`,
  `cost_cents INTEGER`, `usage TEXT` (raw JSON, future-proof).
- **Cloud capture:** new `cursor.getRunUsage(agentId, runId)` → `GET
  /v1/agents/{id}/usage?runId=…`, called at run completion in `executeRun`. Prefer
  `cost.chargedCents` when present; otherwise fall back to a pricing map in settings
  (`pricing: { [model]: { input_per_mtok, output_per_mtok, cache_read_per_mtok } }`, editable on
  the Settings page) and flag the result as an estimate.
- **Local capture:** the CLI `result` event is already parsed in `localAgent.ts` — extend to grab
  any usage fields it emits; otherwise record `duration_ms` only and mark tokens unavailable.
- **Display:**
  - Cost chip per node in the `NodePanel` header (Σ of its runs; tooltip: per-run breakdown with
    model, duration, tokens, cost).
  - Flow-total badge in the flow page header.
  - Rollups computed inside `getFlow()` — no new endpoints needed.
  - The `finished` lifecycle event's `data` gets `{ durationMs, tokens, cost }` so the run-summary
    row reads e.g. `build finished · 4m 12s · 76k tok · $1.24`.

### 1B. Thinking-stream merging

- **Server throttle:** in `executeRun`'s `onThinking`/`onAssistant`, buffer deltas per run and
  flush at most every ~1.5s (plus a final flush at run end) as one event. Cuts event rows 10–50×
  without losing content. Cap the cumulative thinking buffer (~4k chars, keep head+tail) instead
  of the current 500-chars-per-delta slice.
- **Client grouping:** `ActivityFeed` groups **consecutive same-run, same-type events** into one
  collapsible card. Grouping key: `run_id` added to event `data` at emission (fallback for old
  rows: node + type + contiguity + <30s gap). Rendered as `🧠 Thinking (1,240 words)`, collapsed
  by default, expandable to the joined text.

### 1C. Tool-call clubbing & run-centric UX

- **Pairing:** cloud provides `callId` (thread it through `cursor.streamRun`'s `onTool`);
  local pairs by (run, name, FIFO unmatched-start). One row per invocation:
  `read_file src/auth.ts — 0.4s ✓`, expandable to args + result. Stop pre-truncating args to 300
  chars at emission — store full JSON in `data`, truncate only for display. Per-tool icons
  (Read/Write/Shell/Search/Web/MCP) + outcome badge (✓/✗/truncated).
- **Run sections:** group the feed into collapsible run blocks — header
  `▸ plan · run started 14:02 · cloud · model-X`, footer with duration/tokens/cost from 1A.
  Active run streams open; finished runs auto-collapse.
- **Controls:** filter toggles in the tab header (Thinking off by default; Tools; Status);
  lifecycle + errors always visible. Assistant text rendered via the existing `Markdown`
  component.
- Implementation: `groupEvents(events): RunSection[]` util + rewritten `ActivityFeed.tsx`;
  server change limited to emission metadata + throttle.

## Phase 2 — Configurable node prompts with edit modal

*Low-med risk. Default templates are today's strings verbatim → zero behavior change on day one.*

- **`lib/engine/prompts.ts` (new):** template registry per node key —
  `{ label, description, template, variables[], mode }`. `{{var}}` placeholders: `{{ticket}}`,
  `{{plan}}`, `{{branch}}`, `{{logs}}`, `{{comments}}`, `{{feedback}}`, `{{instructions}}`,
  `{{diff}}`, `{{mode}}`. `resolvePrompt(nodeKey, ctx, extra)` renders them; all five executors
  in `nodes.ts` refactor to call it.
- **Two override layers:**
  - Global defaults in `settings.prompt_templates` (new Settings-page section with a template
    editor).
  - Per-run override via `nodes.prompt_override TEXT` column (idempotent migration); the final
    resolved prompt is stored in `nodes.input.prompt` for audit + retry fidelity.
- **API:**
  - `GET /api/flows/[id]/prompt?node=plan&feedback=…` → fully resolved prompt without running
    anything (powers the modal preview).
  - Action route (`start_plan`, `refine_plan`, `review`, `resolve`, `pipeline_fix`) accepts an
    optional verbatim `prompt`.
  - `PATCH /api/settings` extended for `prompt_templates` (unknown node keys rejected).
- **UI:**
  - New `PromptModal.tsx` + lightweight overlay in `components/ui/`.
  - Entry points: secondary "Edit prompt & run" beside "Generate plan" / "Refine" /
    "Run AI review" / "Resolve" (one-click default behavior unchanged).
  - Modal: node description, editable monospace textarea with the resolved prompt,
    click-to-insert variable chips, "Reset to template", char count.
  - Small ⚙ in `NodePanel` header showing which template/override a node uses.

## Phase 3 — Structured multi-branch plans + independent review loops

*Med-high risk. Decisions confirmed: one MR per branch, reviewed independently; sub-agent option
for both plan and build steps.*

### 3A. Structured plans

- Plan template requests a trailing ` ```json plan-meta ` block:
  `{ branches: [{ name, title, scope, files[], steps[], dependsOn[] }] }` → parsed into
  `artifacts.meta.branches`. **Parse failure = today's single-branch behavior** (zero regression).
- Executor validates the JSON (slug-safe, unique names); invalid → one auto-retry with the
  validation error as follow-up before surfacing to the user.
- PlanView renders branch cards (name, scope, file count, steps) when multiple branches exist;
  approve all-sequential or per-branch. Single-branch UI unchanged.

### 3B. Plan fan-out via sub-agents (option)

- "Decompose" toggle on the plan node: the plan agent delegates exploration to sub-agents per
  repo area and merges results.
  - *Cloud:* pass `customSubagents` (max 20) on `createAgent`.
  - *Local:* instruct the CLI agent to use its built-in Task subagents — prompt-level, no new
    machinery.

### 3C. Multi-branch builds with independent MRs

- New `branches` table: `id, flow_id, name, title, status, mr_url, mr_iid, order, created_at,
  updated_at`. `flows.mr_branch/mr_url/mr_iid` remain the primary branch (backward compat +
  single-branch fast path).
- `buildBranch(ctx)` gains a suffix param (it's deterministic per flow today — guaranteed
  collision otherwise).
- **Sequential first:** build runs branches in `dependsOn` order; each yields its own diff
  artifact + its own MR on approval; review/resolve/poller/webhook iterate over the flow's
  branch rows. `findFlowByMR` resolves the branch row.
- **Parallel (sub-agent builds):**
  - *Local:* `git worktree add` per branch so concurrent `cursor-agent` processes never share a
    checkout; extend `localAgent.createLocalRun` with a `cwd` override + cleanup on finish.
  - *Cloud:* one agent per branch (`startingRef` per branch; optionally `customSubagents` per
    branch scope). Use client-supplied `agentId` for idempotent creation; respect `409
    agent_busy`.
  - Concurrency cap setting (default 2). Per-branch runs carry `branch_id` on the `runs` row, so
    cost/activity attribution from Phase 1 works unchanged.

---

## Sequencing & risk

| Phase | Scope | Risk |
|---|---|---|
| 1 | Activity UX + thinking merge + cost (via `/usage` + `chargedCents`) | Low |
| 2 | Prompt registry + templates + preview endpoint + edit modal | Low-med |
| 3A/B | Structured plans, branch cards, sub-agent planning option | Med |
| 3C | Sequential multi-branch builds → parallel worktree/multi-agent builds, multi-MR loops | Highest |

**Flag:** cloud-mode features (cost via `/usage`, `customSubagents`, parallel cloud agents)
can't be exercised until cloud agents are enabled on the team (the current API key gets `401`).
Phases 1–2 should be validated against local mode, where everything except `/usage` works today.
