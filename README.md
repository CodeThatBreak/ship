# DevFlow — Single-screen Developer SDLC Cockpit

One screen for a developer's whole SDLC: **Task (Jira, or any registered task provider) → Plan → Build → Merge Request → CI/CD → AI Review → Comment resolution** — powered by Cursor agents (**cloud** or **local CLI**, per flow) and self-hosted GitLab (multiple instances supported). Integrations are pluggable adapters behind engine-side ports — adding a git host, agent runner, or task provider is one adapter file + one `register()` line.

## Execution modes: cloud vs local

Every flow runs its agent nodes (plan, build, fix, review, resolve) in one of two modes, chosen when the flow is created:

- **☁ Cloud** — [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent/api) run on Cursor infrastructure against the repo's cloud URL. Requires a Cursor API key in **Settings → Integrations → Harness**.
- **💻 Local** — agents run in-process via `@cursor/sdk` (`Agent.create({ local: { cwd } })`) in the repo's configured **local path**, using the same DB-stored Cursor API key, your local git credentials, and live edits in your checkout. Follow-ups resume the same SDK session.

Set the default mode and local-agent options (auto-approve tools, sandbox, timeout) on the **Settings** page; override per task on the home page.

## Settings page (`/settings`)

- **Agent execution** — default cloud/local mode + local SDK options (auto-approve tools, sandbox, timeout), plus the **default model** for agent runs (list comes from the Cursor API when a key is configured, with a built-in fallback list otherwise; per-run overrides on each node's run buttons and in the *Edit prompt & run* dialog). `DEFAULT_MODEL` env remains the final fallback. Also the **comment-resolution quiet period**: how long after the last new MR comment the Resolve node auto-starts (default 10 min; set the node's `quiet_minutes` config to change it). The resolve always waits for the pipeline step to pass first, regardless of this delay.
- **Repositories** — registry of your repos: `name`, `cloudUrl` (any GitLab domain), `localPath` (needed for local mode + local diffs), `defaultBranch`. Local paths are validated (must be a git repo).
- **Git host instances** — one entry per self-hosted GitLab domain (`base_url` + PAT with `api` scope). DevFlow picks the token whose domain matches each repo's cloud URL for API calls, MRs, CI polling, comments, and cloning. Each instance has a **Test** button to verify auth. (GitLab is the first registered git host; the settings UI reads host metadata from `GET /api/git-hosts`.)

## The loop

```
┌───────┐   approve   ┌───────┐  approve  ┌──────────┐ green ┌──────────┐
│ Plan  │ ──────────► │ Build │ ────────► │ Pipeline │ ─────► │ Review   │
│ v1..N │ ◄── refine  │ diff  │  MR first │ (CI gate)│        │ (agent)  │
└───────┘             └───────┘           └────┬─────┘        └────┬─────┘
                                          CI fail│ (auto-fix)      │ comments
                                               ◄─┘             ┌───▼──────┐
                                               ◄───────────────┤ Resolve  │──┐
                                                 re-gate       └──────────┘  │ loop
                                                               ▲─────────────┘
```

- **Plan node** — Cursor agent (plan mode) reads the repo + task PRD + Figma links and drafts an implementation plan. Refine it in a loop; every iteration is versioned (`v1, v2, …`) and you can view/diff each version. Every planner turn returns a JSON envelope (`PlanTurnOutput`: a `reply` plus at most one of a full plan, a sub-plan, or a checklist patch). A published plan version is an ordered **step checklist** (`{id, title, detail, files, branch}`) plus optional multi-branch decomposition, persisted as validated JSONB in the plan artifact's meta (`{feedback, steps, branches, refinedFrom, scopedRefine}` — written by `planStore.persistPlan`) — there is no markdown meta block to parse. The checklist is extracted into an **editable UI**: toggle steps done, retitle/reword, add/delete steps, reorder — manual edits survive across refinements, and done steps stay done when a refinement keeps their id.
- **Build node** — Cursor agent (agent mode) implements the approved plan, pushes a branch. The pending checklist is injected into the build prompt; the agent reports progress through the authenticated `claim_checklist_progress` tool (or the `build-progress` prose fence as a fallback) and steps get **checked off automatically** (you can also toggle them by hand in the Build panel, which shows live checklist progress). You review the **diff in-screen**, then approve → creates the **GitLab MR** and waits for it. If the push is rejected (pre-push/pre-receive hooks — type checks, lint gates), a commit-fix agent repairs the code in the build step and retries automatically; infra errors (network/auth) hand the step back with the error so you can fix it and click **Approve & create MR** again.
- **Pipeline node (CI gate)** — after the MR exists (and after every later code change — comment resolutions, build refines), the gate ensures a pipeline exists for the MR head — **triggering one via the GitLab API** (merged-results MR pipeline, falling back to a branch pipeline) when the project doesn't start one on push (manual-CI setups) — then waits for green. While waiting it re-reads the MR **head** pipeline every cycle (so a superseded/retried pipeline never leaves the UI stuck on a stale status) and **plays manual jobs via the API** (bounded) so manual-gated projects don't sit until the timeout; a failed pipeline triggers a fix agent that reads the failed job logs and pushes to the MR branch, then the gate re-waits (bounded attempts). Pipeline failures reported by the webhook/poller also (re)trigger the gate directly. Review only starts once the pipeline is green — and every gate path (approval, re-check, retry, resolve re-gate) runs through the single `afterPipelineGate` chain (gate → review → resolve-if-open), so a green pipeline can never leave review stranded and resolve never double-runs for the same batch.
- **Review node** — an agent reviews the MR diff and posts inline comments.
- **Resolve node** — an agent fixes every open MR comment; loops until none remain. New comments (webhook or poller) **queue** it rather than starting it: the resolve fires only once the pipeline step has passed **and** no new open comment has arrived for the configured quiet period (default **10 minutes** — each new comment resets the timer, so a reviewer dropping several comments gets one resolve run for the batch). Every resolve that changes code re-runs the pipeline gate before the flow returns to review, and any comments still open after the re-gate loop straight back into resolve. Comments the agent resolved stay resolved even when GitLab keeps reporting them as unresolved (plain MR notes — bot reports, summaries — aren't resolvable via the API), so they never retrigger a redundant run.

Everything runs from the single flow screen — workflow graph on top, selected node's content on the left, and a unified right rail panel built on [Vercel AI Elements](https://ai-sdk.dev):

- **Chat** — talk to the currently selected node's agent. Ask the Plan agent to refine the plan, the Build agent to change the implementation, the Review agent to focus on something, etc. Messages route to a follow-up run on that node's Cursor agent (keeping its workspace state), so changes stay in context. Chat messages are interleaved by timestamp with the agent's live run activity.
- **Run activity** (inline in the same timeline) — collapsible run blocks with the agent's thinking, assistant text, tool calls (args/result/duration as `Tool` blocks), status rows, and finished-run summaries (duration · tokens · cost). Flow-level events (MR pushes, pipeline results) render as system rows. Filter chips (Thinking / Tools / Status) control which entries show.

**Failure handling:** if a Cursor/GitLab call fails, the node turns red (failed) and a **Retry** button appears in the node panel — it re-runs the same step with its recorded input. While a node is **running**, a **Stop** button lets you cancel a stuck run (kills the local CLI process / detaches the cloud run) and marks the node failed so it can be retried. Selecting a node in the graph sticks — polling no longer snaps the view back to the running node. The webhook + poller are also guarded so the same node can't be triggered concurrently (which used to spawn duplicate agents on the same branch).

## Setup

DevFlow persists to **Postgres 16** (dockerized by default):

```bash
cp .env.example .env   # fill in workspace path; leave DATABASE_URL unset for production
npm install
npm run db:up          # docker compose up -d postgres (dev `devflow` + test `devflow_test` databases)
npm run db:migrate     # prisma migrate deploy + builtin template seed
npm run dev            # http://localhost:3000  (terminal 1 — the web process)
npm run worker         # terminal 2 — the worker process (see below)
```

Any Postgres works instead of Docker: point `DATABASE_URL` at it and run
`npm run db:migrate`.

### The worker process (two terminals in dev)

The web process is pure request/response: every user action (approve, retry,
run, chat, webhook) claims synchronously in-request through DB-fenced paths,
so the UI works without the worker. **Time-driven** behavior — `wait_for`
timer/comment fires, template schedules, job retries, the reconcile pass,
and the MR pipeline/comment polling — lives in a dedicated worker process:

```bash
npm run worker         # acquires the writer lock, then: poller + reconciler + job sweeps
```

Run it alongside `npm run dev` (two terminals). It is idempotent: the worker
holds a Postgres advisory lock (`pg_try_advisory_lock`), so a second worker —
duplicate deploy, dev accident — logs one line and idles (retrying, so a dead
holder is replaced). `GET /api/health` reports whether the writer lock is held
(`{ writer, since }`). Without the worker running, timers, schedules, and
crash recovery simply pause — nothing is lost, since every deadline and
claim lives in Postgres (`nodes.wait_until`, `nodes.lease_until`, the `jobs`
table).

### Demo flows (showcase the structured plan / editable checklist)

```bash
npm run db:seed                            # DEMO-142 SDLC flow, mid-review (idempotent)
node scripts/seed-demo-flow.mjs --reset    # remove it
node scripts/seed-branch-refine-demo.mjs   # DEMO-207 branch-scoped refine story
node scripts/seed-branch-refine-demo.mjs --reset
```

Seeds a flow with a realistic PRD, a 2-version plan history (v1 multi-branch →
v2 refined single-branch), and the checklist mid-flight: two steps done by hand,
two checked off by a trial build run, one added manually, and one superseded by
the refine. Open the flow and try toggling / editing steps — it's all live data.

### `.env`

Infrastructure only — integration credentials (GitLab, Jira, Cursor) live in the DB via **Settings → Integrations** (Git / Task / Harness tabs). See `.env.example`.

| Key | What |
|---|---|
| `DATABASE_URL` | Postgres connection string. Dev default: the dockerized `postgresql://devflow:devflow@localhost:5432/devflow`; production `next start` uses `postgresql://devflow:devflow@localhost:5432/devflow_prod` when unset. Run `npm run db:migrate` against it once |
| `WORKSPACE_DIR` | Directory for clones and local-agent worktrees (default `./workspaces`; `~` expands) |
| `DEFAULT_MODEL` | Optional last-resort default model id when settings do not specify one |
| `GITLAB_WEBHOOK_SECRET` | Shared secret for `POST /api/webhooks/gitlab` (required unless `GITLAB_WEBHOOK_ALLOW_UNSIGNED=1`) |
| `GITLAB_WEBHOOK_ALLOW_UNSIGNED` | Set to `1` to accept unsigned GitLab webhooks when the secret is unset (local dev only) |
| `SERVER_PUBLIC_URL` | Optional public base URL agents reach this server on (e.g. `https://devflow.example.com`). When set, running agents get the step-08 self-repair tools (`read_flow_state`, `claim_checklist_progress`, `report_failure`) advertised in their prompt, authenticated by a per-attempt capability token. Cloud agents cannot reach `localhost` — unset, the feature stays off and builds report progress via the prose fence as before |

### GitLab webhook (for live CI + comment triggers)

Project → **Settings → Webhooks**:
- URL: `https://<this-app-host>/api/webhooks/gitlab`
- Secret token: your `GITLAB_WEBHOOK_SECRET`
- Triggers: **Comments**, **Merge request events**, **Pipeline events**

> Webhooks need a publicly reachable URL. For local dev use `ngrok http 3000`, or rely on the built-in **30s poller** (no webhook needed) — it watches pipeline status + MR discussions and drives the same fix/resolve loop.

## Using it

1. Register your repos (and GitLab / Jira / Cursor instances) on **Settings**.
2. On the **Tasks** home page (`/`), use **Refresh** to load assigned issues from the configured task provider (Jira first). Materialize a row when you start a build.
3. Pick a repo + execution mode (☁ Cloud / 💻 Local) for the task on the home page, click **▶ Build** → a flow is created.
4. In the **Plan** node: *Generate plan* → refine with feedback (each creates a new version) → **Approve plan & start build**.
5. In **Build**: review the diff → **Approve & create MR** — the MR is created (push-hook rejections are fixed by an agent in-place), then the **Pipeline** gate waits for green CI, fixing failures itself.
6. From there the loop is automatic: review/agent comments → Resolve → pipeline gate re-check → back to Review, until the MR is clean.

## Custom flows — templates, the visual builder, and custom nodes

The built-in SDLC loop is one template among many. **Templates** (`/templates`)
compose the built-in nodes with your own — **agent** (prompt, plan or agent mode,
markdown/JSON out), **decision** (expression / manual pick / agent classifier with
branch edges), **http** (outbound call, `{{secrets.NAME}}` interpolated at run
time, SSRF-guarded), and **script** (shell / node / python via execa) — into
reusable flows, editable as UI *and* config-as-code (YAML import/export).

- **Gallery** (`/templates`) — starters pinned on top (SDLC loop, docs generation,
  release notes + notify, Sentry triage), duplicate to customize, delete, and
  real YAML import/export. YAML fixtures live in `docs/flow-templates/`.
- **Visual builder** (`/templates/<id>`) — a drag-drop canvas: drag nodes to
  arrange, drag from a node's side handle onto another node to connect, click a
  node to open its **configuration drawer** (display name + Trigger / Config /
  Contract tabs), click an edge to edit kind/label/condition. The node palette
  adds catalog and authored nodes; **Flow settings** (drawer) edits name,
  description, and the flow trigger (manual / webhook + filter / schedule +
  interval, with task/repo binding). Node positions persist as you drag;
  structural changes save on **Save** (refused while flows are mid-run on the
  template — positions-only sync always passes).
- **Runtime** — flows snapshot their template at creation; running flows are
  never affected by template edits. Decision cards, waiting-node hook endpoints,
  and engine semantics are documented in [`docs/coding-patterns.md`](docs/coding-patterns.md)
  and the template YAML fixtures under `docs/flow-templates/`.

### Custom-flow demo

```bash
node scripts/seed-custom-flow.mjs         # two demo flows on the "Release notes + notify" starter
node scripts/seed-custom-flow.mjs --reset # remove them
```

Seeds two complete flows on DEMO-201: one where the decision picked **send**
(draw → decision card → notify), one where it picked **drop** (the notify branch
ends **skipped**) — open them to see the template-derived graph, the decision
outputs, and the taken-edge highlight without any agent runs.


## Architecture

```
app/                    Next.js App Router
  (workspace)/page.tsx  Tasks home — live task feed, start flow (repo + mode picker)
  settings/             repos registry, git-host instances, execution defaults, integrations
  flows/[id]/page.tsx   the single-screen cockpit
  flows/page.tsx        flow list
  templates/            template gallery + the visual builder (drag-drop canvas
                        over the template graph, node/edge drawers)
  api/                  tasks, flows, actions, events, comments, webhooks, hooks, repos,
                        git-hosts, host-instances, settings, models, graph,
                        templates (+import/export), node-templates, contracts
components/flows/       WorkflowGraph, NodePanel + panels/ (self-registering panel
                        registry keyed by node def/kind — no node_key switches),
                        DiffView, ReviewView (normalized comments payload)
components/template-editor/  visual builder (BuilderCanvas on @xyflow/react), NodeConfigurator (Trigger/Config/Contract), AddNodeDialog

lib/                    strict OOP: one class per responsibility; services are plain module
                        consts or constructor-injected from the composition roots
                        (lib/composition/) — the Prisma client is the only process singleton
  config.ts             AppConfig — env-sourced infrastructure config (db, workspace,
                        optional webhook secret, SERVER_PUBLIC_URL and DEFAULT_MODEL);
                        integration secrets in DB
  composition/          the composition roots: container.ts (request-scoped stateless
                        services + the engineParts wiring), processServices.ts
                        (pinnedProcessService — the only home for process-bound
                        in-memory state: run handles, worktree coordination, def caches)
  utils.ts              Styles — Tailwind-aware className merging (`cn` alias for components)
  groupEvents.ts        EventGrouper — folds the flat event list into run sections for the unified chat panel
  engine/ports/         the integration boundary — neutral interfaces + normalized types the
                        engine/UI code may import; nothing in lib/engine imports a concrete
                        integration (adapters live in lib/integrations and register into registries)
      git-host.ts       GitHostClient / GitHostService — change requests, pipelines, comments,
                        authed clone URLs, normalized webhooks (HostInstance, NormalizedWebhookEvent)
      agent-runner.ts   AgentPort — start/followUp/getRun/cancel/stream/getUsage/listModels/status
                        over normalized RunResult / RunUsage / ModelInfo
  integrations/         the adapters — one folder per integration, wrapping the vendor SDK/API:
    gitlab/             GitLab git-host adapter (+ GitLabClient) — registered in gitHostRegistry;
                        instance credentials from the DB; webhook secret from env when set
    cursor/             Cursor cloud adapter over cursorSdk.ts CursorAgentService (unified runtime
                        shared by both modes); cursor.ts CursorClient is a thin shim over it
    local-agent/        Local agent adapter (in-process agent loop: branch checkout, settings)
  engine/
    flowEngine/         FlowEngine — generic graph mechanics only: registry-driven node runs,
                        input maps, edge conditions (JSONata), joins, triggers, wait-arming,
                        webhook/timer resume, approvals/retry/cancel. The SDLC gate→review→
                        resolve loop is template data; flow/ holds the action services
                        (FlowApprovalService, FlowChatService, FlowRetryService,
                        FlowPlanStepService, FlowManualRunService).
    runtime/            the engine's runtime layer (target-architecture §1):
      transitions/      TransitionAuthority — the ONLY writer of nodes.status/attempt_id;
                        the declared transition table + typed transition events
      staging/          StageRunner (stage claim → input materialization → consumes check →
                        run → outcome publish), InputMaterializer, ConditionEvaluator, LoopJoin
      triggers/         TriggerGateway — every trigger (run/retry/chat/approve/webhook/timer/
                        schedule/poller) claims here; the loser emits skipped_duplicate_trigger
      contractPipeline.ts  ContractPipeline — validates stage-start input against the node's
                        `consumes` and terminal output against its outputSchema (fail loud)
      waits/            WaitStore — durable nodes.wait_until waits (timers, the debounced resolve)
      jobs/             JobQueue — write-ahead job journal (webhook deliveries, schedule fires,
                        MR creation, cancels) with lease-based claims + dedup keys
      effects/          EffectRegistry — "what happens after Y finishes" as registrations
                        (SDLC chain sequencing, loop joins)
      reconcile/        Reconciler — walks every non-terminal node on open/poll: leases, durable
                        waits, per-status handlers + RecoveryDriver (the fixed recover() ABI)
      locks/            ProcessLock — the PG advisory lock held by the single writer process
    nodes/
      (stable node-key constants live in lib/engine/constants/nodeKeys.ts —
                        use NODE_KEYS, not string literals).
      shared/           shared node infrastructure, one class per file:
        nodeDefinition.ts   NodeDefinition (abstract): key/label/order/edges + Zod inputSchema/
                            outputSchema/consumes + capabilities (refinable, chatMode, panelTitle)
                            + run/chat/recover, with shared services injected.
        agentRunNode.ts     AgentRunNode — the agent run lifecycle: startAgent/executeRun via the
                            agent-runner port registry, streaming, the agent-tools prompt block.
        runContext/         FlowContextHelper — mode/branch/diff facts + the {{task.*}} context
                            universe (generic keys + the provider's contextFields).
        nodeSupport.ts      NodeSupport — row/artifact/run persistence helpers.
      harness/          StreamBuffer (buffered thinking/assistant event flushing), ToolPairer
                        (tool-call start/end pairing for local mode), UsageTracker (token/cost
                        accounting over the port usage types).
      shared/agentOutput/  AgentOutputPipeline — the one agent-output path: extractJson → contract
                        validation → bounded feedback retry → typed events (no silent defaults).
      plan/             PlanNode — the unified plan turn envelope (PlanTurnOutput) parse/validate
                        (planContract.ts), artifact persistence + checklist sync (planStore.ts —
                        writes artifacts.meta {feedback, steps, branches, refinedFrom, scopedRefine}),
                        prompt assembly (planPrompt.ts);
                        schema.ts holds the Zod schemas.
      build/            BuildNode — build + chat-refine, build-progress application
                        (buildFinalizer), diff artifact, branch recovery; branchStore.ts
                        (BranchStore) for multi-branch branch rows.
      mergeRequest/     MergeRequestService — MR creation between build approval and the
                        pipeline gate; classifies push rejections (CommitError) so the
                        build step can fix them with an agent.
      pipeline/         PipelineNode — the CI gate: waits for a green MR head pipeline
                        (re-reading the head every cycle, playing manual jobs via the
                        API when a pipeline stalls on `manual`), running fix agents on
                        failures (bounded), before review may start. Also (re)triggered
                        by pipeline-failure webhooks/polls. Durable gate progress
                        (GateProgressStore) survives restarts.
      review/           ReviewNode — MR diff review, inline comment posting.
      resolve/          ResolveNode — open-comment resolution + discussion closing.
      chains/           sdlcChain.ts — the builtin SDLC chain module (gate→review→resolve
                        re-gate loop); its post-finish sequencing is declared as effect
                        registrations in sdlcEffects.ts (engine-overhaul step 07).
      registry.ts       NodeRegistry — the single source of truth: node map, graph order, edges, labels.
    agentTools/         AgentToolService + ToolRegistry — the authenticated self-repair surface
                        for running agents (read_flow_state, claim_checklist_progress,
                        report_failure) behind the per-attempt capability token (runs.api_token).
    prompts/            PromptLibrary — prompt templates (customizable via settings);
                        untrustedData.ts/caps.ts wrap untrusted interpolation loudly.
    tasks/              TaskProvider registry — one class per task provider
                        (providers/jira.ts: fetch, ADF→text, PRD/figma extraction, upsert sync);
                        task providers are an extension point: subclass TaskProvider + register
                        in the registry — the sync route, import screen, and {{task.*}} lint pick it up
    runtime/flowPoller.ts  FlowPoller — 30s poll: pipeline status + MR discussions → pipeline-gate
                        triggers; new comments restart the debounced resolve's quiet period
                        (the WaitStore re-defers when quiet + the gate is clear); also sweeps
                        due waits and jobs in the worker process
    runtime/reconcile/  Reconciler — re-syncs stuck `running` nodes with real run state on flow open/poll
    templates/          TemplateStore — flow templates (graph, nodes, edges, trigger) + the static
                        lint cluster (templateLint.ts + lint*.ts)
    templates/templateYaml.ts  YAML export/import (config-as-code §7 shape); validation is the store's
  git/local.ts          LocalGit — clone/diff/push/worktrees; authed clone URLs come from the
                        repo's git-host adapter (no integration imports here)
  db/
    prismaClient.ts     PrismaClient (pg driver adapter) — the ONLY process singleton
    database.ts         Database — Prisma-backed facade: transactions, store composition,
                        app-side uid/now; raw get/all/run for legacy read paths
    rows.ts             Zod schemas for JSONB payload columns + RowGateway — payloads are
                        validated once at the DB boundary, so consumers never see `any`.
    ../prisma/schema.prisma  Postgres schema source of truth (camelCase fields, @map columns,
                        enums, JSONB) + prisma/migrations/
worker/main.ts          the worker process (npm run worker): writer advisory lock, then the
                        poller + reconciler loop + job sweeps — all time-driven behavior
data/                   (sqlite-era files; the one-off scripts/migrate-sqlite-to-pg.mjs
                        reads a legacy devflow.db to load its data into Postgres)
workspaces/             per-flow dirs: git worktrees for local agent runs (Phase 1 worktrees —
                        ensured at the runner for every unpinned mutating run; the registered
                        checkout stays the hub and is never mutated), plus clones used for
                        diffs (cloud mode)
```

### Ports & adapters (the integration boundary)

`lib/engine/ports/` defines what an integration *is* to the engine — neutral
names (change request, pipeline, comment, agent run), no vendor types. Each
integration ships an adapter under `lib/integrations/` and registers itself:

| Port | Adapters | Registry | Consumed by |
|---|---|---|---|
| `GitHostClient` / `GitHostService` | `integrations/gitlab` | `gitHostRegistry` (per-repo client routing, webhook normalization) | pipeline/review/resolve nodes, poller, merge-request service, `/api/webhooks/*`, `/api/git-hosts` + `host-instances` |
| `AgentPort` | `integrations/cursor`, `integrations/local-agent` | agent-runner registry (exec-mode key) | `agent-runner.ts`, `/api/models`, settings + model-selector metadata, usage tracker |
| `TaskProvider` | `tasks/providers/jira` (+ `contextFields`, `externalUrl`) | `taskRegistry` | flow context (`{{task.*}}`), task sync/import, lint universe |

Adding an integration = one adapter file + one `register()` line; engine, UI,
and DB never learn the vendor's names.

**Multi-user-ready:** all state is per-flow/per-task in Postgres. To go multi-user, add auth and scope queries by user — the engine is stateless across requests.

## Adding a new node type

The workflow is a registry of `NodeDefinition` classes — one folder per node type in `lib/engine/nodes/`. To add one:

1. **Create the node folder** — `lib/engine/nodes/<name>/` with:
   - `schema.ts` — strict Zod `inputSchema` (everything a run needs — validated on trigger **and** on retry) and `outputSchema` (what gets persisted to the node's `output` column)
   - `<name>Node.ts` — the node class extending `NodeDefinition<I, O>` from `nodes/shared/nodeDefinition.ts`: declare `key` (from `NODE_KEYS` in `lib/engine/constants/nodeKeys.ts`), `label`, `order` (graph position), `edges` (graph connections), and `promptKeys`; implement `run(ctx, input)` — usually via the base `execute()` helper, which handles status/input persistence, agent start (cloud/local), streaming, cost capture, artifact saving, output validation, and the lifecycle event; optionally override `chat()` (follow-up runs on the node's agent) and `recover()` (how to finish a run that completed while the server was down — return `{ kind: "manual", reason }` to fail for manual retry, the right choice for nodes with non-idempotent side effects; the fixed recovery ABI never throws)
   - declare `consumes` / `outputSchema` (Zod) — the ContractPipeline validates stage input and terminal output against them; a status write never happens outside the TransitionAuthority
   - a registration-only export module (`<kind>Exports.ts`) — no barrel imports elsewhere
2. **Register it** — one line in `lib/engine/nodes/registry.ts`.
3. **(Optional) UI panel** — add a panel component under `components/flows/panels/` and
   register it (or the declarative kind's generic panel covers it automatically).

Everything else is automatic: node rows are created per flow from the registry, the workflow graph's layout/edges/labels come from `/api/graph` (registry-derived), retry re-validates the recorded input against the node's schema, chat routes to the node's `chat()`, and reconcile delegates recovery to the node's `recover()`.

Nodes are pluggable — the same engine can model other use cases (docs generation, release notes, QA) by registering a different node set.

## Notes

- **Agent self-repair tools (step 08):** while an agent run is in flight it can call the flow's own API — `POST /api/flows/:id/nodes/:nodeKey/agent-tools` with `read_flow_state` (node statuses, open checklist steps, open comments, pipeline state), `claim_checklist_progress` (build — the authoritative progress path), and `report_failure` (any agent kind — fails the node with the agent's reason). Auth is a per-attempt capability token (`runs.api_token`, minted at claim, dead at the terminal transition), not the local-API token; the tools are advertised in the run prompt only when `SERVER_PUBLIC_URL` is set.
- Cursor Cloud Agents work directly against self-hosted GitLab repos (`repos[].url = https://gitlab.company.com/group/repo`) — no local checkout needed for agent runs; local clones are only for rendering diffs.
- Local mode runs the agent in-process via `@cursor/sdk` (`Agent.create({ local: { cwd } })`) in the repo's local path, so the agent can commit and push with your local git credentials. Auth uses the Cursor API key from **Settings → Integrations → Harness** (passed explicitly to the SDK — there is no env fallback in app code; Node ≥ 22.13 required). The `local_agent.sandbox` setting maps to `local.sandboxOptions.enabled`; `local_agent.force` maps to `send({ local: { force } })` to expire a wedged run before a follow-up. The SDK surfaces per-run token usage, so local runs record tokens as well as duration/model. Build prompts instruct it to create a `bugfix/<ticket>-<id>` branch (`feature/` for stories — repos commonly enforce branch-name patterns via pre-receive hooks, which reject `cursor/...` names); fix/resolve runs check out the MR branch first (best effort). If the branch didn't get pushed (agent died, network), the MR step pushes it from the local checkout — trying the origin remote first, then the token-authed HTTPS URL.
- Every node run streams live assistant/thinking/tool events into the unified chat panel from the SDK's normalized `SDKMessage` stream (`run.stream()`) — the same event shape whether the agent runs locally or in a Cursor VM.
- **Restart resilience:** local runs execute in-process, so a dev-server restart leaves their nodes stuck in `running`. The reconciler (`lib/engine/runtime/reconcile/`) walks every non-terminal node on flow open/poll and never trusts in-process bookkeeping: liveness is the durable lease (`nodes.lease_until` / `runs.lease_until`, heartbeated by the owning loop) plus the SDK's persisted local store (`Agent.getRun(...).status`), which is the ground truth for how the turn ended — a finished turn is recovered through the node's `recover()` (plan text / build diff / gate resume), an unfinished or unloadable run is failed so you can retry. The pipeline gate's server-side wait loop heartbeats the node lease while it polls; an expired lease hands the node to `recover()`, which re-enters the wait from the durable `gate_progress` snapshot (the original deadline rides it, so a crash loop cannot reset the window), and a retry re-reads the current head pipeline (an already-green pipeline finishes immediately). For cloud mode it asks the Cursor API and re-attaches the event stream for runs that are still going. A late-finishing run whose node was already failed/retried is ignored instead of resurrecting the node or double-stamping an artifact. All git commands have timeouts so an unreachable remote can never hang the page.
