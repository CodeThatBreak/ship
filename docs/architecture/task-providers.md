---
node_key: task-providers
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Task providers

## Summary

Task providers connect DevFlow to external ticketing systems and feed flow creation. The `TaskProvider` registry is the single source of truth for task types; today it registers one provider, Jira. Tasks are **never synced into the DB for browsing** — the tasks table fetches them live (60 s TTL cache), and a row is only materialized (`upsertLive`, idempotent on key) when a build actually starts, because the flow engine needs the row for the FK and `{{task.*}}` context hydration.

## Architecture

### The port (`lib/engine/tasks/taskProvider.ts`)

`TaskProvider` defines: `kind` / `label`, `configured()` (settings-page health), `liveFetch(filters)` → `LiveTask[]`, `upsertLive(task)` materialization, `externalUrl(task)`, `contextFields` (the `{{task.*}}` vocabulary the template linter checks statically), and an optional `instanceStore()` for multi-instance management on Settings → Integrations.

`LiveTask` carries the shared task contract (`key`, `summary`, `description`, `status`, `issueType`, `priority`, `externalUrl`, `parentKey`) plus a provider-specific `fields` payload and the `raw` provider response for faithful re-materialization. `LiveTaskFilters` (`assignee`, `statusCategory`, `text`) are provider-composed into the native query language (Jira → JQL); with no filters the provider falls back to its configured default query.

### Registry and services

- `TaskProviderRegistry` (`tasks/registry.ts`) — one `register()` line per provider in `registerBuiltins()`; the provider list (`GET /api/tasks/providers`), homepage filters, and the lint vocabulary all derive from it.
- `LiveTaskFeed` (`tasks/liveTaskFeed.ts`) — the live browse path: normalized filter tuple as cache key, 60 s `TtlCache` (stale-on-error with `meta.stale`), `fresh=1` bypass.
- `TaskService` (`tasks/taskService.ts`) — materialized rows listing (newest `synced_at` first, external URL backfilled from the provider) and `repo_url` updates.

### The Jira provider

- **Transport and auth** (`lib/integrations/jira/`): `JiraService` manages the DB-backed instance registry (Settings → Integrations → Task; single instance supported today, tokens sealed at rest — see `database.md`). `apiProfile.ts` derives the auth mode from the base URL host: `*.atlassian.net` → `cloud_basic` (Basic auth, `/rest/api/3/…`), anything else → `dc_bearer` (Bearer token, `/rest/api/2/…`). Credential checks call `/myself` with a timeout and truncated error bodies.
- **Fetch and materialize** (`tasks/providers/jira.ts`): JQL search → `LiveTask` mapping; ADF descriptions render to text (`adfRenderer.ts`); the PRD text and scanned Figma links live in `fields.prd` / `fields.figma_urls`, which the flow-context hydration spreads over the generic `{{task.*}}` keys (fields keys override — see `lib/engine/context/flowVariables.ts`).
- **Instance validation** — `lib/integrations/instanceBaseUrl.ts`, `instanceCredentialPolicy.ts`, and `instanceRouteValidation.ts` normalize/validate instance URLs and credentials at the route boundary (shared with git-host instances); rows live in `jira_instances` via `lib/db/stores/jiraInstanceStore.ts`.

## API surface

| Route | Purpose |
|-------|---------|
| `GET /api/tasks` | Materialized task rows + per-provider `configured` flags |
| `GET /api/tasks/live?kind=&assignee=&statusCategory=&text=&fresh=` | Live provider fetch through `LiveTaskFeed` (cached, meta carries `cached`/`stale`/`ageSeconds`) |
| `POST /api/tasks/materialize` | Write-through of one picked live task into `tasks` (idempotent on key) |
| `PATCH /api/tasks/:id` | `repo_url` update on a materialized task |
| `GET /api/tasks/providers` | Registered provider kinds + labels |
| `GET/POST /api/task-instances/:kind`, `GET/PUT/DELETE /api/task-instances/:kind/:id` | Provider instance CRUD (Jira) + credential test |

## Data model

- `tasks` rows: materialized only, keyed by provider `type` + `key`; common columns carry the shared contract, provider payload in `fields` JSON, `raw` for re-materialization, `synced_at` for ordering.
- `jira_instances` rows: instance registry with sealed tokens (`IntegrationSecretStore`).

## Out of scope

- Flow creation from a task — see `flow-engine.md` (`FlowFactory`).
- The tasks table UI and homepage filters — frontend concern; the contract surface is the routes above.
- Git-host instances (GitLab) — see `gitlab-integration.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Provider port | `lib/engine/tasks/taskProvider.ts` |
| Registry | `lib/engine/tasks/registry.ts` |
| Live feed + cache | `lib/engine/tasks/liveTaskFeed.ts` |
| Task service | `lib/engine/tasks/taskService.ts` |
| Jira provider | `lib/engine/tasks/providers/jira.ts` |
| Jira service/instances | `lib/integrations/jira/service.ts`, `singleton.ts` |
| Jira auth profile | `lib/integrations/jira/apiProfile.ts` |
| ADF rendering | `lib/integrations/jira/adfRenderer.ts` |
| Instance validation | `lib/integrations/instanceBaseUrl.ts`, `instanceCredentialPolicy.ts`, `instanceRouteValidation.ts` |
