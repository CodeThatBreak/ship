# Tickets → Tasks — Implementation Plan

Date: 2026-10-24 · Status: shipped (Phases 1–4)

> Implementation status: Phase 1 (model rename), Phase 2 (provider registry +
> import screen) and Phase 3 (template task context) are merged. Phase 4
> (cleanup) dropped the `{{ticket.*}}` runtime alias and lint root, removed the
> `/api/tickets` shim, moved the jira-only payload (`prd`, `figma_urls`) fully
> into `tasks.fields` (data-fix + column drop), and updated README / flow-template
> fixtures to `{{task.*}}`. Legacy YAML documents still import: the import-time
> `ticket_id` drop + `{{ticket.*}}` → `{{task.*}}` rewrite is the permanent
> bridge (the runtime context no longer carries the alias).

## Goal

Replace the hard-coded **Jira ticket** concept with a first-class, extensible **Task**
concept as the unit that starts a flow:

1. **Task types are an extension point** — a provider registry (same idiom as
   `NodeDefinition` + `NodeRegistry` and the declarative-kind factory). The first
   provider is **Jira Task** (existing sync logic), and new types (Linear, Sentry
   issue, …) plug in without touching the engine.
2. **Flows start from tasks** — `flows.ticket_id` becomes `flows.task_id`; every
   flow references a task of some type.
3. **All template nodes get Task context** — when authoring a template, every node's
   `input_map`, prompts, and expressions evaluate against a `task` variable universe
   (like `repo`/`flow` today), sourced from the template's declared task type and
   statically lint-checked for `{{task.*}}` refs.

Audience unchanged: individual devs running DevFlow locally / self-hosted.

## Current state (what we're changing)

| Concern | Today | File refs |
|---|---|---|
| Ticket model | `tickets` table, fixed SQL columns mirroring Jira (`key`, `summary`, `description`, `status`, `issue_type`, `priority`, `prd_text`, `figma_urls`, `repo_url`, `parent_key`, `jira_url`, `raw`, `synced_at`) | `lib/db/schema.sql:3-18`, `lib/db/index.ts:117-120` |
| Zod models | `TicketRow` + camelCase `Ticket` (`parent_key` missing from row schema) | `lib/db/rows.ts:30-62` |
| Sync | Only source: Jira via `POST /api/tickets` → `JiraClient.fetchMyTickets()` + `normalize()` | `app/api/tickets/route.ts:18-39`, `lib/integrations/jira.ts:54-98` |
| Flow gating | `flows.ticket_id NOT NULL`; `FlowEngine.create()` throws "ticket not found — sync Jira first" | `lib/db/schema.sql:22`, `lib/engine/flow.ts:71-93` |
| Flow context | `{{ticket.key / summary / description / prd}}` — a fixed 4-field shape wired for Jira | `lib/engine/flow-context.ts:38-43` |
| Template trigger binding | `flow_templates.trigger` may pin a specific `ticket_id`; auto-start errors if it no longer exists | `lib/engine/templates.ts:661`, `lib/engine/flow.ts:1348-1383` |
| Template authoring | No task awareness in the editor; `{{ticket.*}}` placeholders appear only as example strings | `components/template-editor/*` |

---

## Locked decisions (proposed)

| Decision | Choice | Rationale |
|---|---|---|
| Extensibility idiom | **Provider registry in code** (`TaskProvider` abstract class + `taskRegistry`), **not** a `task_types` DB catalog | Task types ship code (sync, normalize, auth) — unlike declarative nodes, there's no authorable config payload; a code registry is simpler and matches `NodeRegistry`/built-ins. Revisit a DB catalog only when a user-configurable task type is genuinely needed. |
| Storage | One generic `tasks` table with a `type` discriminator + `fields` JSON column for provider-specific data | Matches the discriminated-kind idiom (`node_templates.kind`); common columns stay shared so listing/sorting/UI stays simple |
| Context root | `{{task.*}}` in the context map; keep `{{ticket.*}}` as a **deprecated alias** for one release so existing YAML templates and prompts keep working | Zero-break bridge; lint warns on alias use |
| Template → task binding | Templates declare a **task type** (`trigger.task_type`, default `jira`) instead of pinning a specific ticket; flows receive the concrete task at start time | Auto-start (webhook/schedule) shouldn't depend on one mutable row existing; task-specific pinning, if needed later, becomes a filter field on the trigger |
| Task context for nodes | Task context is **globally available** to every node (part of the base context map, like `repo`/`flow/trigger`) — no wiring needed; the template editor surfaces the task type's context fields and lints every node against them | "All nodes should have Task context" without per-node plumbing |
| Task acquisition | **Import screen only** — tasks come exclusively from integrations (sync via provider `sync()`); no manual task creation, ever. The same screen lists and re-imports across providers as more types ship | Single acquisition path keeps the model clean; home page becomes task launcher, import happens on a dedicated screen |

---

## 1. Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│ Task layer (design + runtime)                                      │
│  tasks table          — generic rows: type discriminator + fields  │
│  lib/engine/tasks/    — task-provider.ts (abstract), registry.ts,  │
│                         providers/jira.ts (moved from lib/         │
│                         integrations/jira.ts normalize logic)      │
│  POST /api/tasks      — list/sync/create via registry              │
├────────────────────────────────────────────────────────────────────┤
│ Flow layer                                                         │
│  flows.task_id        — renamed from ticket_id (FK → tasks)        │
│  FlowEngine.create()  — gates on task existence (any type)         │
│  startFromTemplate()  — validates payload vs template's task type  │
├────────────────────────────────────────────────────────────────────┤
│ Template layer                                                     │
│  trigger.task_type    — which task type the template accepts       │
│  context-lint         — {{refs}} resolve task universe for         │
│                         EVERY node (task is base-context)          │
│  NodeConfigurator     — shows task context fields per node         │
│  TaskContextSection   — new template-editor panel (pick type,      │
│                         preview fields it exposes)                 │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Task provider contract

New file `lib/engine/tasks/task-provider.ts`, mirroring
`NodeDefinition` (`lib/engine/nodes/base/node-definition.ts`) and the start-contract
field style (`lib/engine/nodes/start/contract.ts:21`):

```ts
export interface TaskField {
  key: string;                          // exposed as {{task.<key>}}
  label: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
}

export abstract class TaskProvider {
  abstract readonly kind: string;       // "jira"
  abstract readonly label: string;
  /** What this task type contributes to the {{task.*}} universe. */
  abstract readonly contextFields: TaskField[];
  /** Pull-based sync: upsert external issues as task rows. */
  abstract sync(): Promise<string[]>;   // returns upserted task ids
  /** Where to view this task externally (UI deep link). */
  abstract externalUrl(task: Task): string;
}

export function taskRegistry: ... // kind → TaskProvider, registerJiraTaskProvider() etc.
```

- The Jira provider owns everything `lib/integrations/jira.ts` currently does
  (fetch, `normalize()`, `extractPrd`, figma scan, ADF→text). `contextFields`
  for jira: `key, summary, description, prd, status, priority, issue_type, figma_urls, repo_url`.
  This list becomes the lint vocabulary `(§4)`.
- Adding a new task type = one file under `lib/engine/tasks/providers/` +
  a `taskRegistry.register(...)` line, plus UI naturally picks it up from a
  `listTaskProviders()` route — the same recipe the registry doc comment
  (`lib/engine/nodes/registry.ts:13-18`) prescribes for nodes.

## 3. Data model & migration

All in the idempotent `Database.migrate()` pattern of `lib/db/index.ts` (SQLite ≥3.25,
bundled with better-sqlite3, supports `RENAME`):

```sql
-- tickets → tasks
ALTER TABLE tickets RENAME TO tasks;
ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'jira';
ALTER TABLE tasks ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';  -- provider-specific JSON
-- flows
ALTER TABLE flows RENAME COLUMN ticket_id TO task_id;
-- (keep FK semantics by recreating the table if RENAME COLUMN drops FK targets)

-- template triggers: {"type":"manual"} → {"type":"manual","task_type":"jira"} backfill
```

Schema/type changes:

- `lib/db/schema.sql`: rename table; add `type` + `fields` columns; keep common
  columns (`key`, `summary`, `description`, `status`, `repo_url`, `jira_url`,
  `parent_key`, `raw`, `synced_at`) as the **shared contract** across task types;
  move jira-only payload (figma urls, prd) into `fields` via the migration's data fix.
- `lib/db/rows.ts`: `TaskRow` / `Task` (camelCase) replacing `TicketRow`/`Ticket`;
  add the missing `parent_key`; add `type`; parse `fields` as object.
- `flow_templates.trigger` schema (`TemplateStore`, `lib/engine/templates.ts:63-118,661`):
  add optional `task_type` (validated against a `TASK_TRIGGER_TYPES` const = registered
  provider kinds); drop `ticket_id` handling; `FlowEngine.startFromTemplate()`
  matches payloads to the declared type's contract.

## 4. Context & templates — Task context on every node

1. **Context map** (`lib/engine/flow-context.ts`): rename `ticket` → `task`;
   hydrate common columns + spread `fields`; keep a `ticket` alias key
   (same object) emitting a one-time deprecation event/log so old YAML still runs.
   `FlowCtx` in `lib/engine/nodes/base/` gains `task: Task`.
2. **Lint** (`lib/engine/context-lint.ts`): the linter already checks upstream node
   contracts; add `task` to every node's universe using the template's
   `trigger.task_type` → provider `contextFields`. A `{{task.figma_urls}}` ref that
   jira doesn't expose becomes a template-save error instead of an empty string at
   runtime — same philosophy as existing `{{refs}}` checks.
3. **Template editor** (`components/template-editor/`):
   - New "Task context" panel: pick the task type (from `listTaskProviders()`), see
     the fields it exposes; template default `jira`.
   - `NodeConfigurator.tsx` / `AddNodeDialog.tsx`: task variables shown as
     insertable `{{task.*}}` chips alongside `{{nodes.*}}` for **every** node — no
     per-node wiring; replace hardcoded `{{ticket.*}}` example strings (lines ~321, ~575).
4. **YAML** (`lib/engine/templates-yaml.ts`): export/import `task_type`; accept and
   auto-remap `ticket_id`/`{{ticket.*}}` on import with a warning.
5. **Start contract** (`lib/engine/nodes/start/contract.ts`): webhook/schedule
   templates can seed contract fields from the task type's `contextFields`
   (optional generator button in the editor; keeps both mechanisms composable).

## 5. API & UI surface

| Area | Change |
|---|---|
| `app/api/tickets/route.ts` + `[id]/route.ts` | Move to `app/api/tasks/…`; keep `/api/tickets` as a thin deprecated shim (sync via registry, `Cache-Control` warning header) for external scripts |
| Task acquisition | Import screen (`app/tasks/import/page.tsx` or dedicated route) listing registered providers ("Connect / Import from Jira"); calls `POST /api/tasks/sync` per provider; shows provider-specific import progress and newly fetched tasks. No manual create UI |
| `app/page.tsx` (homepage) | Ticket list → **task list** grouped by type filter; "Build ticket" → "Build task" launches a flow on a picked task; `startFlow()` PATCHes `tasks.repo_url` and POSTs `{taskId, …}` |
| `app/flows/[id]/page.tsx`, `NodePanel.tsx`, `PlanView.tsx` | Rename ticket UI affordances; context references become `{{task.*}}` |
| `app/api/flows/route.ts` | `create(ticketId, …)` → `create(taskId, …)` (`lib/engine/flow.ts:29-117`) |
| `docs/`, `README.md` | Ticket → task language |

## 6. Phases (each independently shippable)

- **Phase 1 — Model rename (no behavior change)**: migrate `tickets`→`tasks`,
  `flows.ticket_id`→`flows.task_id`, add `type`/`fields`; `TaskRow`/`Task` models;
  shim `/api/tickets` → `/api/tasks`; mechanical grep-driven rename
  (`lib/engine/flow.ts`, `lib/db/index.ts`, `app/page.tsx`, context key aliases).
  *Exit: app behaves identically, `{{ticket.*}}` still works.*
- **Phase 2 — Provider registry + import screen**: `lib/engine/tasks/` (`task-provider.ts`,
  `registry.ts`, `providers/jira.ts` absorbing `lib/integrations/jira.ts`
  normalization + sync); sync route dispatches through the registry; task import
  screen replaces the homepage ticket-sync flow. The "Task acquisition" row in
  §6 folds in here.
  *Exit: Jira flows work through `TaskProvider` with zero logic in `flow.ts`.*
- **Phase 3 — Template task context**: `trigger.task_type`, context map `task`
  root + alias, context-lint `task` universe, editor Task-context panel +
  `{{task.*}}` chips on every node, YAML import/export + remap, start-contract
  seeding. *Exit: authoring any template node sees and is lint-checked against task context.*
- **Phase 4 — Cleanup**: drop the `{{ticket.*}}` alias and `/api/tickets` shim
  (one release later), remove jira-specific fields left in shared columns,
  update docs.

## 7. Risks / open questions

- **RENAME COLUMN + FK**: `flows.ticket_id REFERENCES tickets(id)` — renaming the
  referenced table may require recreating `flows` to keep the FK valid; plan the
  migration as a data-fix script with a pre-copy of `data/devflow.db`.
- **`prd` / `figma_urls` in shared columns**: providers shouldn't each flood the shared
  column set — the jira provider puts its extras in `fields`; confirm no runtime code
  outside the provider reads those columns directly.
- Open for review: whether schedule-trigger templates should be able to *pick up
  tasks by filter* rather than manual start; timing for dropping the
  `/api/tickets` shim.
