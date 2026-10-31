# Task 47: Thin route handlers backed by services

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 11: Zod at the API boundary: settings, repos, instances, templates](11-api-input-validation-settings.md)
- **Findings:** CR-051, CR-053, CR-168, CR-169, CR-172, CR-175, CR-177, CR-178, CR-179
- **Effort:** L

## Goal

Routes still run raw SQL and domain logic, loaders and routes build the same payloads separately, and domain strings repeat across routes. Move each block into its owning service.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-051 [Medium] Routes run raw SQL and domain logic instead of calling service methods

- **Status:** Open
- **Type:** Code quality
- **Effort:** L
- **Where:** app/api/templates/[id]/preview/route.ts:54,80,85,117,133,147, app/api/status/route.ts:12,30-31, app/api/flows/[id]/comments/route.ts, app/api/flows/[id]/events/route.ts:15-18, app/api/artifacts/[id]/route.ts:12, app/api/flows/worktree-status/route.ts:20, app/api/graph/route.ts, app/api/models/route.ts:74, app/api/contracts/route.ts, app/api/templates/[id]/validate/route.ts:54, app/api/tasks/handlers.ts:30, app/api/node-templates/route.ts:20-48, app/api/webhooks/gitlab/route.ts:64-66
- **What to do:** Routes still run raw SQL and domain logic (preview sample context, status snapshot, comment mapping, worktree status, model-catalog normalization, contracts, validate's copy of `taskUniverse`, `tasks/handlers.ts` UPDATE, node-template auto-naming/slugging). Move each block into its owning service (TemplateStore, StatusService, ModelCatalogService, …), delete `app/api/tasks/handlers.ts`, and add tests for the new services.

### CR-053 [Low] Node-template responses are serialized differently in different places, and the create/update responses lack `is_local`

- **Status:** Open
- **Type:** Code quality
- **Severity:** Low (was Medium)
- **Effort:** S
- **Where:** app/api/node-templates/route.ts:58, app/api/node-templates/[id]/route.ts:24,28, loaders/templates.ts:76-88, lib/engine/templates/template-store.ts:63
- **What to do:** Three serializations still exist: POST/PATCH return `{...nt, is_builtin}` without `is_local`, `loadNodeCatalog` builds its own shape, and `serializeNodeTemplate` stays unexported; the loader comment still wrongly says it matches the GET. Current clients only invalidate (never write the mutation result into the cache), so the impact is latent. Export one serializer (or `templateStore.catalogRows()`) and use it in all three places.

### CR-168 [Low] Loaders and routes build the same payloads separately, and one copy has already drifted

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** loaders/tasks.ts:23-24,38-40,49-52; loaders/templates.ts:23-33; app/api/tasks/providers/route.ts:11-19; app/api/settings/route.ts:75-78; app/api/models/route.ts:73-75
- **What to do:** The provider list is still serialized in three places, and `loaders/tasks.ts` still leaves out `contextFields` even though its comment says it matches `GET /api/tasks/providers`. Default-model resolution is duplicated between the settings and models routes, and the `default_execution_mode` read is duplicated between the tasks loader and the settings route. Add `taskRegistry.describe()`, `settingsService.defaultModel()` and `settingsService.defaultExecutionMode()`, and call them from both the loaders and the routes.

### CR-169 [Low] Domain strings are repeated as literals instead of named constants

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** app/api/settings/route.ts:14,44-49,73-88,122-176; app/api/models/route.ts:35,74; loaders/tasks.ts:50-52; app/api/status/route.ts:25,30,46; app/api/webhooks/gitlab/route.ts:49,62,68; app/api/contracts/route.ts:64; app/api/templates/route.ts:21-24; lib/engine/prompts/prompt-preview.ts:99,126; app/api/flows/[id]/action/route.ts:36-85; components/flows/panels/FanoutStepList.tsx:143,149,157 (plus AgentView/HttpView/ScriptView/DecisionView/StartView action calls); app/api/node-templates/route.ts:22-27
- **What to do:** All cited literal groups are still present: settings keys, `cloud`/`local`, SQL `'active'`/`'running'`, wait sources, `"start"`/`"nt_start"`/`"auto"`/`"all"`, action names (a `Record<string, …>` map on the server, raw strings on the client) and the node-kind label map. The only change is that the prompt-template keys moved from the prompt route into `PromptPreview`, still as literals. Reuse `FLOW_STATUS`, `WAIT_FOR_SOURCES`, `nodeRegistry.entryKey()` and `KINDED_NODE_TEMPLATE_KINDS`; add client-safe `SETTINGS_KEYS`, `EXECUTION_MODE` and `FLOW_ACTIONS` constants (type the action map `Record<FlowAction, …>`); and bind SQL status values as parameters.

### CR-172 [Low] `GET /api/graph` falls back to a default graph for unknown flow or template ids

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** app/api/graph/route.ts:20-25,51-55
- **What to do:** `?flowId=<unknown>` still resolves to null and falls back to `SDLC_TEMPLATE_ID`, and `?templateId=<unknown>` makes `templateStore.graph` return null and falls through to the registry graph. Both return 200 with a plausible but wrong graph. Return 404 when the flow or template isn't found. Drop the null-`template_id` → SDLC fallback too: it only exists for legacy flows, which are out of scope.

### CR-175 [Low] `tasks/live` keeps its cache in module-level mutable state

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** app/api/tasks/live/route.ts:20-25,55-104
- **What to do:** The TTL cache is still module-level mutable state in the route file, so HMR drops it, and the route still owns the cache-key derivation and the stale-on-error policy. Move all of this into a `LiveTaskFeed` service in `lib/engine/tasks/`, created via `processSingleton`, and keep the route to Zod-parsing the filters and calling it.

### CR-177 [Low] Auto-naming in `POST /api/node-templates` can race and fail on the unique key

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** app/api/node-templates/route.ts:22-27,37-48; lib/engine/templates/template-store.ts:571-609,970-972
- **What to do:** The race itself does not reproduce: better-sqlite3 is synchronous and there is no `await` between the `nodeTemplateByKey` check and `createNodeTemplate`, so in-process requests cannot interleave there. What remains is business logic in the route: auto-naming lives there with its own copy of the slug regex, which must stay in sync with the private `TemplateStore.slugify`, and `body.key` bypasses that check. Move auto-naming into `TemplateStore.createNodeTemplate` (an optional "auto-name" mode), reusing `slugify`.

### CR-178 [Low] Worktree status lists worktrees once per flow instead of once per repo

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** app/api/flows/worktree-status/route.ts:27,55,62-67
- **What to do:** Each flow still calls `worktrees.listWorktrees(repo.local_path)` plus `isWorktreeDirty` and `localBranchState`, all fanned out with an unbounded `Promise.all`, so about 3N git processes run per poll. Group flows by `repo_id`, list each repo's worktrees once, and cap concurrency, inside a `WorktreeStatusService`.
- **Fix after:** CR-051 (this task)

### CR-179 [Low] The template editor's SSR QueryClient defaults are a hand-copied, already-divergent version of the app provider's

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** app/templates/[id]/page.tsx:29-38; app/providers.tsx:12-21
- **What to do:** The SSR QueryClient still hand-copies `staleTime: 30_000` and `refetchOnWindowFocus: false`, and adds `retry: false`, which the client provider doesn't have. Export a `QUERY_CLIENT_DEFAULTS` constant (for example `constants/queryClient.ts`) plus a `makeServerQueryClient()` helper, and use them in both places.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
