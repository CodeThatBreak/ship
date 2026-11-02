---
node_key: domain-services
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Domain services

## Summary

The domain services are the class-based backends behind the workspace and per-flow API routes that don't belong to the engine orchestrator: artifacts, comments, output contracts, settings, system status, and the model catalog. Each follows the AGENTS.md §3 conventions — constructor-injected dependencies, thin route handlers, Zod at the boundary — and most are HMR-safe `processSingleton`s.

## Architecture

### Artifact service (`lib/artifacts/artifactService.ts`)

Read-side accessor for artifact rows: `get(id)` returns the validated `ArtifactRow` or throws `NotFoundError`. Serves `GET /api/artifacts/:id` (the artifact viewer/downloader). Artifact *writes* stay engine-side (`NodeSupport.saveArtifact`) — see `node-infra.md`.

### Comment service (`lib/comments/commentService.ts`)

Read model for the flow comment inbox: `listForFlow(flowId)` maps ingested comment rows into the API shape (`ApiComment`: thread id, author, body, path/line, `status`, `resolvable`/`resolved`). Serves `GET /api/flows/:id/comments`, polled by the review panel every 8 s (see `review-node.md`). Comment *ingestion* is the engine's `CommentIngestor` — see `flow-engine.md`.

### Contract service (`lib/contracts/contractService.ts`)

Resolves a node's **output contract** for the template editor's Contract tab: `GET /api/contracts?def=<key>&kind=<kind>&config=<json>` looks up the def (builtin via the registry, declarative via its kind), applies the optional instance config overlay, and returns the def's `outputContract()` JSON schema plus its prompt template sections (`promptSections` over the `PromptLibrary`). The start contract is exposed through `startContractJsonSchema`. Input is validated by `contractParamsSchema`.

### Settings service (`lib/settings/settingsService.ts`)

The typed accessor over app-level settings rows: `defaultModel()` (normalized model spec with env fallback), `httpAllowlist()` (hostname allowlist for the http node's SSRF guard), `defaultExecutionMode()`, and `update(patch)` — validated by `SettingsPatchBody` (`lib/schemas/settingsPatch.ts`) with per-key normalization (model spec normalization, allowlist parsing). Serves `GET/PATCH /api/settings`.

### Status service (`lib/status/statusService.ts`)

The system snapshot behind `GET /api/status` (the status bar): active agents (flow id, task key/summary, current node, execution mode, MR state), running-run count, open MRs, and repo count — pure read SQL over `flows` ⨝ `tasks`, `runs`, and `repos`.

### Model catalog service (`lib/modelCatalog/modelCatalogService.ts`)

Normalizes the agent port's model catalog for `GET /api/models`: merges catalog entries by id, filters noise fast-param variants, and reports `source: "catalog" | "fallback"` (fallback = the port's `fallbackModels` when the catalog is unreachable) plus the resolved default choice (id + params). Backed by the `AgentPortRegistry` — see `agent-harness.md`.

### Cross-cutting helpers

- **`TtlCache`** (`lib/cache.ts`) — minimal in-memory TTL cache (60 s default, 500-entry cap, stale entries retained 2× TTL for stale-on-error reads). Absorbs bursts of identical external fetches; the live task feed is the consumer (`task-providers.md`).
- **`groupEvents`** (`lib/groupEvents.ts`) — client-side activity-feed grouping: events ordered by `(created_at, id)` group into run sections by `data.run_id` (fallback: node + contiguity + <30 s gap heuristic), coalescing consecutive thinking/assistant events and pairing tool start/finish into single invocation rows.

## API surface

| Route | Service |
|-------|---------|
| `GET /api/artifacts/:id` | `ArtifactService.get` |
| `GET /api/flows/:id/comments` | `CommentService.listForFlow` |
| `GET /api/contracts` | `ContractService.resolve` |
| `GET/PATCH /api/settings` | `SettingsService` (+ `loadSettings` assembly) |
| `GET /api/status` | `StatusService.snapshot` |
| `GET /api/models` | `ModelCatalogService.normalized` |

## Data model

All services read through the validated row layer (`lib/db/rows.ts` — see `database.md`): `artifacts`, `comments`, `settings`, `flows`/`tasks`/`runs`/`repos`. Only `SettingsService.update` writes.

## Out of scope

- Repo registry (`lib/repos/repoService.ts`) — covered in `gitlab-integration.md`.
- Engine-side writes (artifacts, comments, runs) — see `flow-engine.md` and `node-infra.md`.
- Secrets/settings encryption — see `database.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Artifacts | `lib/artifacts/artifactService.ts` |
| Comments | `lib/comments/commentService.ts` |
| Contracts | `lib/contracts/contractService.ts` |
| Settings | `lib/settings/settingsService.ts` |
| Status | `lib/status/statusService.ts` |
| Model catalog | `lib/modelCatalog/modelCatalogService.ts` |
| TTL cache | `lib/cache.ts` |
| Feed grouping | `lib/groupEvents.ts` |
