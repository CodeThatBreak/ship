# Pristine codebase plan — generic engine, pluggable integrations, end-to-end

Status: **Proposal — for review, no code changes yet**

Goal: make the whole codebase pristine — no legacy dependencies, working end to end,
and structurally generic: **integration contracts never leak into engine/UI code**;
everything is pluggable via adapters and data (templates, contracts, registries).

Current verified state: `tsc --noEmit` clean, `next build` clean, no TODO/FIXME debt,
no dead engine modules. The debt is architectural, listed below with exact file:line
evidence.

---

## Current-state audit (what forces this plan)

### A. Git-host integration has no abstraction
`lib/integrations/gitlab.ts` exports a concrete `GitLabClient` + singleton
`GitLabService`. **Every consumer imports it directly:**

| File | Use |
|---|---|
| `lib/engine/nodes/merge-request/merge-request-service.ts:3` | create/update MRs, writes `flows.gitlab_project_id` |
| `lib/engine/nodes/pipeline/pipeline-node.ts:4` | ~10 call sites (getMR, getPipeline, createMRPipeline, createPipeline, listPipelineJobs, playJob, retryPipeline, getJobTrace) |
| `lib/engine/nodes/review/review-node.ts:3` | getMRChanges, createMRNote |
| `lib/engine/nodes/resolve/resolve-node.ts:4` | resolveDiscussion, getMR |
| `lib/engine/poller.ts:2` | getMR, listMRDiscussions |
| `lib/engine/flow.ts:12` | `hostOf` + webhook matching on `flows.gitlab_project_id` (:1500-1521), wait-source key `"gitlab_pipeline"` (:419-423) |
| `lib/git/local.ts:6,48-60` | token-embedded clone URL hardcodes `oauth2:TOKEN@` (GitLab-only) |
| `app/api/settings/route.ts:4` | `gitlabConfigured` status |
| `app/api/gitlab-instances/*` | admin CRUD for the integration itself (legit, but GitLab-shaped) |

Plus **GitLab-shaped schema/UI**: `gitlab_instances` table, `flows.gitlab_project_id`
column, `WAIT_FOR_SOURCES = ["gitlab_pipeline", "gitlab_comments", "webhook", "timer"]`
(`templates.ts:30`), `/api/webhooks/gitlab` route, and `components/ReviewView.tsx:40,54`
parsing **raw GitLab note JSON in the UI**.

→ Adding GitHub today means touching ~20 files across engine, API, UI, DB.

### B. Agent runner is Cursor-only at the dispatch point
`lib/engine/nodes/base/agent-runner.ts:44-80` hardcodes the `localAgent` vs
`cursorClient` dispatch on `execMode`. A second runner (different vendor or runtime)
requires edits in `agent-runner.ts`, `lib/config.ts`, `app/api/settings/route.ts:32-33`,
`app/api/models/route.ts:57`, `lib/modelSpec.ts`, `lib/usage.ts`,
`components/ModelSelector.tsx:55`, `usage-tracker.ts`, settings page labels.
Note: `cursor.ts` + `localAgent.ts` already share one runtime (`cursorSdk.ts`) — the
port just needs to be formalized so the *engine* stops importing either singleton.

### C. Task-provider registry is pluggable but Jira leaks through it
The one real adapter pattern (`TaskProvider` + `TaskProviderRegistry`) still leaks:
- `templates.ts:24` `DEFAULT_TASK_TYPE = "jira"` (also :690-695 fallback)
- `lib/db/schema.sql:5` `tasks.type DEFAULT 'jira'`; `:15` `jira_url` column
- `lib/db/rows.ts:40,44,70` `jiraUrl` on the Task shape
- `flow-context.ts:63-77` hardcodes jira keys `prd`/`figma_urls` into the
  `{{task.*}}` universe for **every** provider; `:42` renders `# Jira ${t.key}:`
- `prompts.ts:31,54,81,109,253` "Jira ticket" literal text
- `build-node.ts:147-148` "Jira ticket"; `merge-request-service.ts:90` `ctx.task.jiraUrl`
- `app/api/tasks/handlers.ts` `jiraConfigured` field + `t.jiraUrl` fallback
- `app/page.tsx:49`, `app/flows/[id]/page.tsx:46`, `scripts/check-branch-refine.ts`

### D. SDLC lifecycle hardcoded in engine core
`lib/engine/flow.ts` (1,562 lines) carries:
- `firstKeyOfType(...)` role lookups for plan/build/pipeline/review/resolve
- `runGateChain()` (:803-892) — inline gate→review→resolve-if-open→re-gate loop,
  self-documented as *"carries the loop's conditions until edge conditions arrive
  with the Phase 3 decision/JSONata work"* — Phase 3 has since landed
- `scheduleResolve`/`resolveDue` quiet-period scheduler (:955-1057)
- `createMrWithFixes()` commit-fix retry (:901-932), `MrCreationFailed`
- `loop` edges are display-only metadata (:455-457)

Also: `reconcile.ts:61` hardcodes literal node key `"pipeline"`; `flow.ts:635`
hardcodes `defKey === "start"`; `prompts.ts` keys templates off `NODE_KEYS`.

### E. UI hardcodes node types
- `components/NodePanel.tsx:32-59` switches on `node_key` / `kind` → bespoke panels
- `components/ChatPanel.tsx:196` refine toggle gated on `nodeKey === "plan"`;
  `:294` `chatOnly` logic plan-vs-rest; `:213` `/prompt?node=plan`; `:433,566`
- `app/flows/[id]/page.tsx:53` default selection `useState("plan")`; `:113-118` plan
  special-casing
- `lib/groupEvents.ts:299-314` **regex-guesses** event→node ownership from message text
- Meanwhile generic panels (AgentNodePanel, DeclarativeNodePanel) already exist for
  declarative kinds — the mechanism is there, builtins just don't use it.

### F. Legacy residue (small)
- `zod-to-json-schema` in package.json — **unused** (0 imports)
- `nodes/plan/index.ts` "legacy helpers" section; `plan-node.ts:923` legacy parse fallback
- `declarative-schemas.ts:32` legacy `inputs` field (pre parent-output model)
- YAML import `ticket_id` / `{{ticket.*}}` compat (`templates-yaml.ts:168-274`,
  `app/templates/page.tsx:100,174,287`) — **decision: remove**
- Empty `devflow.db` at repo root (real DB is `data/devflow.db`)
- `docs/ai-elements-migration.md` stale; `docs/repo-detail-page.md` proposal w/ no code
- `app/api/contracts/route.ts:110-174` duplicates declarative contract knowledge
  route-locally instead of on the defs

---

# Phase 1 — Integration ports & adapters

**Outcome:** engine/UI/DB speak neutral language (`git host`, `agent runner`, `task
provider`). Adding GitHub/Linear/another agent vendor = one adapter file + one
`register()` line. Nothing in `lib/engine` imports a concrete integration.

## 1.1 Git-host port

**New file `lib/engine/ports/git-host.ts`** — neutral interface + normalized types.
Naming goes neutral everywhere: "change request" (MR/PR) keeps the acronym-agnostic
term `ChangeRequest`, "pipeline" is already generic.

```ts
export interface ChangeRequest { id: string; number: number; title: string; state: string;
  webUrl: string; sourceBranch: string; targetBranch: string; sha: string;
  headPipeline?: { id: string; status: string; webUrl: string } | null; projectId: string; }
export interface Pipeline { id: string; status: string; ref: string; sha: string; webUrl: string; }
export interface HostComment { id: string; threadId: string; body: string; author: string;
  resolvable: boolean; resolved: boolean; system: boolean; path?: string; line?: number;
  createdAt: string; }
export interface GitHostClient { /* methods below */ }
export interface GitHostService {
  clientForRepo(repoUrl: string): GitHostClient | null;   // per-repo routing
  instances(): HostInstance[];                             // {id, name, baseUrl, masked}
  addInstance/updateInstance/removeInstance/testInstance(...)
  parseWebhook(headers, body): NormalizedWebhookEvent | null;
}
```

`GitHostClient` methods = today's `GitLabClient` surface, renamed:
`getChangeRequest, createChangeRequest, listChangeRequestsByBranch, getChanges,
getPipeline, createCRPipeline, createPipeline, listPipelineJobs, playJob,
retryPipeline, getJobTrace, listThreads, createComment, resolveThread, getProject`.

**Adapter `lib/integrations/gitlab/git-host.ts`** implements the port by wrapping the
existing client/service (mechanical rename of methods, id mapping int→string is
internal). Registration: a module-level `gitHostRegistry` (same idiom as
`TaskProviderRegistry`), `gitlab` registered in `registerBuiltins()`.
- `lib/git/local.ts:48-60` — move `authedCloneUrl(repoUrl, token)` onto the port
  (adapter supplies the URL credential scheme; local.ts stops importing gitlab).
- Webhook: `app/api/webhooks/gitlab` stays as a thin route calling
  `gitHostRegistry.byHost("gitlab").parseWebhook(...)`; normalized event drives the
  same schedule-resolve / re-gate logic. Generic `/api/hooks/[id]` is untouched.
- `app/api/settings/route.ts` — `gitlabConfigured` → per-registered-host
  `configured()` map (generic shape: `{ [hostKind]: boolean }`).
- UI: `ReviewView.tsx` consumes a **normalized comments payload** built server-side
  in `/api/flows/[id]/comments` from the port types; delete the GitLab JSON parsing.
- Settings UI section reads host metadata (label, placeholder) from
  `/api/tasks/providers`-style endpoint → new `GET /api/git-hosts` (kinds, labels,
  instances). `gitlab-instances` routes become `host-instances` (keep old route as a
  one-release alias or update settings page in the same commit — same PR, so no alias
  needed).

## 1.2 Agent-runner port

**New file `lib/engine/ports/agent-runner.ts`**:

```ts
export interface AgentPort {
  kind: "cursor-cloud" | "cursor-local";   // registry key
  label: string;
  start(input: AgentStartSpec): Promise<{ agentId; runId; sessionId? }>;
  followUp(handle: string, prompt: string, opts?): Promise<...>;
  getRun(handle): Promise<RunResult | null>;
  cancel(handle): Promise<boolean>;
  stream(handle, callbacks): Promise<void>;
  getUsage(handle): Promise<RunUsage | null>;
  listModels(): Promise<ModelInfo[] | null>;
  status(): Promise<{ configured: boolean; detail?: string }>;
}
```

Normalized `RunResult`/`RunUsage` live in the port file (they're already near-identical
between cursor.ts and localAgent.ts). Two adapters wrap the existing services. The
mode→port mapping ("cloud"/"local" exec mode) comes from settings through
`FlowContextHelper`, resolved inside `agent-runner.ts` via the registry — the engine
imports only the port.

UI/models: `/api/models` + `ModelSelector` + settings read port metadata
(`listModels`, labels) from a new `GET /api/agent-ports` (or extend `/api/models`).
`usage-tracker.ts` uses the port's usage type.

## 1.3 De-Jira the task layer (registry already exists)

- **DB migration**: `tasks.jira_url` → `external_url` (new column + copy +
  drop, idempotent like the existing tickets→tasks migration in `lib/db/index.ts`);
  `tasks.type` default `'jira'` → no default (engine always sets it); update
  `rows.ts`, `handlers.ts` (`jiraConfigured` → per-provider `configured()` map,
  `externalUrl` from provider), `app/page.tsx`, `app/flows/[id]/page.tsx`.
- `templates.ts:24` — drop `DEFAULT_TASK_TYPE = "jira"`; resolve default =
  `taskRegistry.first()?.kind ?? "none"`, and template validation requires the flow
  trigger's `task_type` to be a registered provider (lint already can).
- `flow-context.ts` — `{{task.*}}` universe = generic keys
  (`key, title, description, url, type`) **+ `provider.contextFields`**; delete the
  hardcoded `prd`/`figma_urls` (Jira's `contextFields` declares them instead).
  Header renders `# ${provider.label} ${t.key}:`.
- `prompts.ts` + `build-node.ts` — replace "Jira ticket" with
  `task provider label + "ticket"` derived from the flow's task_type.
- `merge-request-service.ts:90` — use `t.externalUrl` / provider-rendered
  task line.

## 1.4 Wait-source neutrality

`WAIT_FOR_SOURCES` → `["pipeline", "comments", "webhook", "timer"]`; migration maps
stored `gitlab_*` values to the new ones on read (or one-shot DB UPDATE in
`migrate()`). `flow.ts:419-423` wait-source matching goes through the port.

**Commit sequence (each green):**
1. Port types + GitLab adapter + registry, migrate engine call sites (no behavior change)
2. Webhook normalization + comments payload normalization (API + ReviewView)
3. Agent-runner port + registry + models/settings UI metadata
4. Jira scrub + DB migration (`external_url`, type default, wait-sources)

**Risk / notes:** DB migrations must be idempotent (pattern exists at
`lib/db/index.ts:48-190`). Env fallback (`GITLAB_BASE_URL/TOKEN`) stays inside the
GitLab adapter. Webhook secrets stay env-based per host.

---

# Phase 2 — Engine core: lifecycle as data

**Outcome:** `flow.ts` is purely generic graph mechanics (registry, input maps,
conditions, joins, triggers, wait-arming, webhook/timer resume). The SDLC
gate→review→resolve→re-gate loop lives in the builtin template as edges +
conditions — or as an isolated builtin-chain module if full data-ification is too
risky in one step.

## 2.1 Extract the SDLC chain out of `flow.ts` (first commit, behavior-preserving)
Move `runGateChain`, `scheduleResolve`/`resolveDue`, `createMrWithFixes`,
`MrCreationFailed`, and the `firstKeyOfType` action handlers into
`lib/engine/nodes/sdlc/chain.ts` as an "SDLC builtin chain" module registered like a
node family. `flow.ts` keeps a single generic hook point (an `advance` interceptor
for builtin chains). Public behavior identical — pure code motion, easy to review.

## 2.2 Express the loop as template data
Builtin `tpl_sdlc_loop` gains the real control edges using existing mechanics:
- `pipeline → review` edge with `condition` = pipeline green
- `pipeline → pipeline-fix` path (decision node: green/failed) — the fix agent
  becomes a declarative agent node or stays the builtin retry inside the pipeline
  node's own `recover()`
- `review → resolve` edge debounced (`trigger: {type: "debounced", minutes}`) —
  replaces the quiet-period scheduler; `wait_for: comments` already exists as a wait
  source
- `resolve → pipeline` `loop` edge becomes a real conditional edge
  (`condition` = resolve changed code)
- Convert `kind: "loop"` display metadata into these real edges; delete the
  display-only pass.

Then delete from `flow.ts`: `runGateChain`, `scheduleResolve`, `resolveDue`,
`resolveChangedCode` (expressed as a JSONata condition over the resolve output
contract), `createMrWithFixes` (moves into merge-request-service's own retry with the
same bounded semantics).

**Prereq check:** confirm debounce triggers + `wait_for: comments` + edge `condition`
combination covers quiet-period reset semantics ("each new comment resets the
timer"). If debounce needs a small extension (reset-on-event while armed), implement
it in `processWaitTimers` generically — that's a feature of the *timer source*, not
of resolve.

## 2.3 Remove remaining literals
- `reconcile.ts:61` — derive pipeline nodes by kind/output contract, not `node_key`
- `flow.ts:635` `defKey === "start"` — use registry kind metadata
- `prompts.ts` — key prompt templates by node kind/contract id, not `NODE_KEYS`
  (or move prompt templates onto node config so each def owns its prompts)
- `/api/contracts/route.ts:110-174` — move `declarativeOutputContract`/`decisionChoices`
  onto the node definitions; route becomes a thin pass-through
- `declarative-schemas.ts:32` — drop legacy `inputs` field after a read-migration
  (map old rows' `inputs` into input_map once in `migrate()`, then remove the field)

**Commit sequence:** 2.1 (motion) → 2.2 template edges + timer-extension (behavioral,
behind the builtin template only) → 2.3 literal scrub.

**Risk:** the gate chain is the product's core loop; 2.1 de-risks by making 2.2 a
pure data change with the chain module still available as fallback. Seed scripts
(`scripts/seed-*.mjs`) + manual flow run validate each commit.

---

# Phase 3 — UI panel contract

**Outcome:** no `node_key` switch statements in UI; panels/capabilities come from the
node contract, same as the engine.

## 3.1 Panel registry
New `components/panels/registry.tsx` (client): `registerPanel(matcher, component)`
keyed by builtin def-key or declarative kind. `PlanView`, `BuildView`,
`PipelineView`, `ReviewView`, `ResolveView`, `StartView`, `AgentView`,
`DeclarativeView` self-register at module import; `NodePanel.tsx` becomes a ~20-line
dispatcher (lookup → render; fallback = generic AgentView/empty state). Exact
replacements for the switches at `NodePanel.tsx:32-59,71-78`.

## 3.2 Capability-driven chat
Add `capabilities` to node definitions (engine-side, surfaced via `/api/contracts`
and the flow detail payload): `refinable?: boolean`, `chatOnlyMode?: "refine" |
"followup"`, `promptNode?: string`. ChatPanel replaces `nodeKey === "plan"` /
`chatOnly` ternaries (:196, :213, :294, :433, :566) with capability lookups.

## 3.3 Selection & events
- `app/flows/[id]/page.tsx:53` — default selection = first node in graph order
  (start node), not `"plan"`; delete `startPlan` hardcode (:118-129) in favor of the
  generic `run_node`/`approve_node` action with the node's contract
- `lib/groupEvents.ts` — stamp `node_key` at emit time in `db.emitEvent` call sites
  (events already have the node in scope); delete the regex block (:299-314).

**Commit sequence:** registry (mechanical) → capabilities (engine + chat) →
selection/events.

---

# Phase 4 — Hygiene, legacy removal, end-to-end validation

**Decision recorded: legacy YAML compat (`ticket_id` / `{{ticket.*}}`) is removed.**

1. `npm uninstall zod-to-json-schema`; delete empty root `devflow.db`
2. Remove YAML compat: `templates-yaml.ts:168-274` migration branch, import notices
   at `app/templates/page.tsx:100,174,287`; import now rejects unknown refs with a
   clear lint error
3. Remove `plan/index.ts` legacy helpers + `plan-node.ts:923` legacy parse fallback
   (structured `plan-meta` parse becomes the only path)
4. Docs: rewrite stale `docs/ai-elements-migration.md` (or delete if superseded);
   `docs/repo-detail-page.md` — decide implement vs archive (out of scope here by
   default; archived by default)
5. End-to-end validation pass (scripted where possible):
   - `npm run seed:demo` / `seed:branch-refine` / `seed:custom` → run each flow screen
   - declarative-only flow (summarize → decision → http/script starter template)
   - YAML export → import → duplicate flow equivalence
   - webhook trigger (`scripts/send-hook.mjs`) + GitLab webhook handling
   - settings: model resolution chain (per-run → setting → `DEFAULT_MODEL`), local
     mode status, GitLab instance test button
6. README refresh to match the final architecture (ports/adapters section)

---

## Suggested build order & sizing

| # | Phase | Scope | Risk |
|---|---|---|---|
| 1 | 1.1–1.2 ports (git host, agent runner) | ~15 files touched, 2 new files | Low (mechanical, behavior-preserving) |
| 2 | 1.3–1.4 jira scrub + DB migration + wait-sources | ~10 files, 1 migration | Medium (migration) |
| 3 | 2.1 chain extraction | 1 move + 1 hook point | Low |
| 4 | 2.2–2.3 lifecycle as data + literal scrub | engine core + builtin template | **Highest — needs e2e run after each commit** |
| 5 | 3.1–3.3 UI contracts | ~8 components | Low |
| 6 | 4 hygiene + validation + docs | small | Low |

Each numbered item lands as one or more green commits (`tsc` + `next build` + seed
flow still runs). No phase depends on an unfinished one except 2.2 benefiting from
1.4's neutral wait-source names.
