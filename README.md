# DevFlow — Single-screen Developer SDLC Cockpit

One screen for a developer's whole SDLC: **Task (Jira, or any registered task provider) → Plan → Build → Merge Request → CI/CD → AI Review → Comment resolution** — powered by Cursor agents (**cloud** or **local CLI**, per flow) and self-hosted GitLab (multiple instances supported). Integrations are pluggable adapters behind engine-side ports — adding a git host, agent runner, or task provider is one adapter file + one `register()` line.

## Execution modes: cloud vs local

Every flow runs its agent nodes (plan, build, fix, review, resolve) in one of two modes, chosen when the flow is created:

- **☁ Cloud** — [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent/api) run on Cursor infrastructure against the repo's cloud URL. Needs `CURSOR_API_KEY`.
- **💻 Local** — the locally installed `cursor-agent` CLI runs on this machine inside the repo's configured **local path**. Uses your `cursor-agent login` session (or `CURSOR_API_KEY`), your git credentials, and lets you watch/edit the agent's changes live in your own checkout. Follow-ups resume the same CLI session.

Set the default mode and local-agent options (auto-approve tools, sandbox, timeout) on the **Settings** page; override per task on the home page.

## Settings page (`/settings`)

- **Agent execution** — default cloud/local mode + local CLI options, plus the **default model** for agent runs (list comes from `cursor-agent models`, falling back to a built-in list when the CLI isn't installed; per-run overrides available on each node's run buttons and in the *Edit prompt & run* dialog). `DEFAULT_MODEL` env remains the final fallback. Also the **comment-resolution quiet period**: how long after the last new MR comment the Resolve node auto-starts (default 10 min; set the node's `quiet_minutes` config to change it). The resolve always waits for the pipeline step to pass first, regardless of this delay.
- **Repositories** — registry of your repos: `name`, `cloud_url` (any GitLab domain), `local_path` (needed for local mode + local diffs), `default_branch`. Local paths are validated (must be a git repo).
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

- **Plan node** — Cursor agent (plan mode) reads the repo + task PRD + Figma links and drafts an implementation plan. Refine it in a loop; every iteration is versioned (`v1, v2, …`) and you can view/diff each version. Every plan also ends with a structured `plan-meta` block — an ordered **step checklist** (`{id, title, detail, files, branch}`) plus optional multi-branch decomposition. The checklist is extracted into an **editable UI**: toggle steps done, retitle/reword, add/delete steps, reorder — manual edits survive across refinements, and done steps stay done when a refinement keeps their id.
- **Build node** — Cursor agent (agent mode) implements the approved plan, pushes a branch. The pending checklist is injected into the build prompt; the agent reports progress back via a `build-progress` block and steps get **checked off automatically** (you can also toggle them by hand in the Build panel, which shows live checklist progress). You review the **diff in-screen**, then approve → creates the **GitLab MR** and waits for it. If the push is rejected (pre-push/pre-receive hooks — type checks, lint gates), a commit-fix agent repairs the code in the build step and retries automatically; infra errors (network/auth) hand the step back with the error so you can fix it and click **Approve & create MR** again.
- **Pipeline node (CI gate)** — after the MR exists (and after every later code change — comment resolutions, build refines), the gate ensures a pipeline exists for the MR head — **triggering one via the GitLab API** (merged-results MR pipeline, falling back to a branch pipeline) when the project doesn't start one on push (manual-CI setups) — then waits for green. While waiting it re-reads the MR **head** pipeline every cycle (so a superseded/retried pipeline never leaves the UI stuck on a stale status) and **plays manual jobs via the API** (bounded) so manual-gated projects don't sit until the timeout; a failed pipeline triggers a fix agent that reads the failed job logs and pushes to the MR branch, then the gate re-waits (bounded attempts). Pipeline failures reported by the webhook/poller also (re)trigger the gate directly. Review only starts once the pipeline is green — and every gate path (approval, re-check, retry, resolve re-gate) runs through the single `afterPipelineGate` chain (gate → review → resolve-if-open), so a green pipeline can never leave review stranded and resolve never double-runs for the same batch.
- **Review node** — an agent reviews the MR diff and posts inline comments.
- **Resolve node** — an agent fixes every open MR comment; loops until none remain. New comments (webhook or poller) **queue** it rather than starting it: the resolve fires only once the pipeline step has passed **and** no new open comment has arrived for the configured quiet period (default **10 minutes** — each new comment resets the timer, so a reviewer dropping several comments gets one resolve run for the batch). Every resolve that changes code re-runs the pipeline gate before the flow returns to review, and any comments still open after the re-gate loop straight back into resolve. Comments the agent resolved stay resolved even when GitLab keeps reporting them as unresolved (plain MR notes — bot reports, summaries — aren't resolvable via the API), so they never retrigger a redundant run.

Everything runs from the single flow screen — workflow graph on top, selected node's content on the left, and a unified right rail panel built on [Vercel AI Elements](https://ai-sdk.dev):

- **Chat** — talk to the currently selected node's agent. Ask the Plan agent to refine the plan, the Build agent to change the implementation, the Review agent to focus on something, etc. Messages route to a follow-up run on that node's Cursor agent (keeping its workspace state), so changes stay in context. Chat messages are interleaved by timestamp with the agent's live run activity.
- **Run activity** (inline in the same timeline) — collapsible run blocks with the agent's thinking, assistant text, tool calls (args/result/duration as `Tool` blocks), status rows, and finished-run summaries (duration · tokens · cost). Flow-level events (MR pushes, pipeline results) render as system rows. Filter chips (Thinking / Tools / Status) control which entries show.

**Failure handling:** if a Cursor/GitLab call fails, the node turns red (failed) and a **Retry** button appears in the node panel — it re-runs the same step with its recorded input. While a node is **running**, a **Stop** button lets you cancel a stuck run (kills the local CLI process / detaches the cloud run) and marks the node failed so it can be retried. Selecting a node in the graph sticks — polling no longer snaps the view back to the running node. The webhook + poller are also guarded so the same node can't be triggered concurrently (which used to spawn duplicate agents on the same branch).

## Setup

```bash
cp .env.example .env   # fill in your keys
npm install
npm run dev            # http://localhost:3000
```

### Demo flows (showcase the structured plan / editable checklist and plan fan-out)

```bash
npm run seed:demo             # insert a DEMO-142 task + flow, mid-review
npm run seed:demo:reset       # remove it
npm run seed:demo:fanout      # insert a DEMO-143 flow mid FAN-OUT (6 step children, mixed states)
npm run seed:demo:fanout:reset
```

Seeds a flow with a realistic PRD, a 2-version plan history (v1 multi-branch →
v2 refined single-branch), and the checklist mid-flight: two steps done by hand,
two checked off by a trial build run, one added manually, and one superseded by
the refine. Open the flow and try toggling / editing steps — it's all live data.

### `.env`

| Key | What |
|---|---|
| `CURSOR_API_KEY` | Cursor dashboard → API Keys. Powers every agent node. |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Jira (self-hosted or Cloud). The tasks table fetches your assigned issues live via the filter bar. |
| `GITLAB_WEBHOOK_SECRET` | Shared secret for the webhook endpoint. |

### GitLab webhook (for live CI + comment triggers)

Project → **Settings → Webhooks**:
- URL: `https://<this-app-host>/api/webhooks/gitlab`
- Secret token: your `GITLAB_WEBHOOK_SECRET`
- Triggers: **Comments**, **Merge request events**, **Pipeline events**

> Webhooks need a publicly reachable URL. For local dev use `ngrok http 3000`, or rely on the built-in **30s poller** (no webhook needed) — it watches pipeline status + MR discussions and drives the same fix/resolve loop.

## Using it

1. Register your repos (and extra GitLab domains) on the **Settings** page.
2. **Import tasks** on the task import screen (`/tasks/import`) — the provider comes from the task registry (Jira first).
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
  and all engine semantics are unchanged (see `docs/custom-flows-plan.md` for
  the full design + per-phase verification notes).

### Custom-flow demo

```bash
npm run seed:custom          # two demo flows on the "Release notes + notify" starter
npm run seed:custom:reset    # remove them
```

Seeds two complete flows on DEMO-201: one where the decision picked **send**
(draw → decision card → notify), one where it picked **drop** (the notify branch
ends **skipped**) — open them to see the template-derived graph, the decision
outputs, and the taken-edge highlight without any agent runs.


## Architecture

```
app/                    Next.js App Router
  page.tsx              task list + start flow (repo + mode picker)
  settings/page.tsx     repos registry, git-host instances, execution defaults
  flows/[id]/page.tsx   the single-screen cockpit
  templates/            template gallery + the visual builder (drag-drop canvas
                        over the template graph, node/edge drawers)
  api/                  tasks, flows, actions, events, comments, webhooks, hooks, repos,
                        git-hosts, host-instances, settings, models, graph,
                        templates (+import/export), node-templates, contracts
components/             WorkflowGraph, NodePanel + panels/ (self-registering panel
                        registry keyed by node def/kind — no node_key switches),
                        DiffView, ReviewView (normalized comments payload)
components/template-editor/  visual builder (BuilderCanvas on @xyflow/react), NodeConfigurator (Trigger/Config/Contract), AddNodeDialog

lib/                    strict OOP: every module is a class with one responsibility, exported as a
                        shared singleton (db, flowEngine, nodeRegistry, …)
  config.ts             AppConfig — env-sourced config grouped by integration (cursor/jira/gitlab/db/workspace)
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
                        env fallback (GITLAB_BASE_URL/TOKEN) and webhook secrets stay inside here
    cursor/             Cursor cloud adapter over cursorSdk.ts CursorAgentService (unified runtime
                        shared by both modes); cursor.ts CursorClient is a thin shim over it
    local-agent/        Local agent adapter (in-process agent loop: branch checkout, settings)
  engine/
    flow.ts             FlowEngine — generic graph mechanics only: registry-driven node runs,
                        input maps, edge conditions (JSONata), joins, triggers, wait-arming,
                        webhook/timer resume, approvals/retry/cancel. The SDLC gate→review→
                        resolve loop is template data (sdlc chain helpers live in nodes/sdlc).
    nodes/
      keys.ts           NODE_KEYS — stable node-key constants (use these, not string literals).
      base/             shared node infrastructure, one class per file:
        node-definition.ts  NodeDefinition (abstract): key/label/order/edges + Zod inputSchema/
                            outputSchema + capabilities (refinable, chatOnlyMode, panelTitle)
                            + run/chat/recover, with shared services injected.
        agent-runner.ts     AgentRunner — startAgent/executeRun via the agent-runner port registry.
        flow-context.ts     FlowContextHelper — mode/branch/diff facts + the {{task.*}} context
                            universe (generic keys + the provider's contextFields).
        node-support.ts     NodeSupport — row/artifact/run persistence helpers.
        stream-buffer.ts    StreamBuffer — buffered thinking/assistant event flushing.
        tool-pairer.ts      ToolPairer — tool-call start/end pairing for local mode.
        usage-tracker.ts    UsageTracker — token-usage and cost accounting (port usage types).
      plan/             PlanNode — plan prompt, structured plan-meta parse/validate
                        (plan-meta-parser.ts), checklist sync, plan recovery; schema.ts holds
                        the Zod schemas.
      build/            BuildNode — build + chat-refine, build-progress application, diff artifact,
                        branch recovery; branch-store.ts (BranchStore) for multi-branch branch rows.
      merge-request/    MergeRequestService — MR creation between build approval and the
                        pipeline gate; classifies push rejections (CommitError) so the
                        build step can fix them with an agent.
      pipeline/         PipelineNode — the CI gate: waits for a green MR head pipeline
                        (re-reading the head every cycle, playing manual jobs via the
                        API when a pipeline stalls on `manual`), running fix agents on
                        failures (bounded), before review may start. Also (re)triggered
                        by pipeline-failure webhooks/polls.
      review/           ReviewNode — MR diff review, inline comment posting.
      resolve/          ResolveNode — open-comment resolution + discussion closing.
      sdlc/             chain.ts — the builtin SDLC chain module (gate→review→resolve
                        re-gate loop) extracted from flow.ts as an advance interceptor.
      registry.ts       NodeRegistry — the single source of truth: node map, graph order, edges, labels.
    prompts.ts          PromptLibrary — prompt templates (customizable via settings)
    steps.ts            PlanStepStore — structured plan checklist: plan-meta sync, edits, build-progress
    tasks/              TaskProvider registry — one class per task provider
                        (providers/jira.ts: fetch, ADF→text, PRD/figma extraction, upsert sync);
                        task providers are an extension point: subclass TaskProvider + register
                        in the registry — the sync route, import screen, and {{task.*}} lint pick it up
    poller.ts           FlowPoller — 30s poll: pipeline status + MR discussions → pipeline-gate triggers;
                        new comments restart the debounced resolve's quiet period (a generic
                        wait-timer — processWaitTimers fires it when quiet + the gate is clear)
    reconcile.ts        Reconciler — re-sync stuck `running` nodes with real run state on flow open/poll
    templates.ts        TemplateStore — flow templates (graph, nodes, edges, trigger) + static lint
    templates-yaml.ts   YAML export/import (config-as-code §7 shape); validation is the store's
  git/local.ts          LocalGit — clone/diff/push/worktrees; authed clone URLs come from the
                        repo's git-host adapter (no integration imports here)
  db/
    schema.sql          tables (tasks, flows, nodes, artifacts, comments, events, runs, plan_steps,
                        branches, repos, gitlab_instances, settings)
    index.ts            Database — better-sqlite3 connection + idempotent migrations, query helpers
                        (get/all/run), settings, repos, events, messages
    rows.ts             Zod schemas for every table row + RowGateway (get/all) — rows are validated
                        once at the DB boundary, so consumers never see `any` or raw JSON strings.
data/devflow.db         demo/dev SQLite — the default target of seed:* scripts (mock data)
data/devflow.prod.db    production SQLite (default when NODE_ENV=production; schema only, no mock
                        data — created via `npm run db:init:prod`; seed scripts refuse to touch it)
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

**Multi-user-ready:** all state is per-flow/per-task in the DB. To go multi-user, add auth, scope queries by user, and swap SQLite for Postgres — the engine is stateless across requests.

## Adding a new node type

The workflow is a registry of `NodeDefinition` classes — one folder per node type in `lib/engine/nodes/`. To add one:

1. **Create the node folder** — `lib/engine/nodes/<name>/` with:
   - `schema.ts` — strict Zod `inputSchema` (everything a run needs — validated on trigger **and** on retry) and `outputSchema` (what gets persisted to the node's `output` column)
   - `<name>-node.ts` — the node class extending `NodeDefinition<I, O>` from `nodes/base`: declare `key` (from `NODE_KEYS` in `keys.ts`), `label`, `order` (graph position), `edges` (graph connections), and `promptKeys`; implement `run(ctx, input)` — usually via the base `execute()` helper, which handles status/input persistence, agent start (cloud/local), streaming, cost capture, artifact saving, output validation, and the lifecycle event; optionally override `chat()` (follow-up runs on the node's agent) and `recover()` (how to finish a run that completed while the server was down — return `false` to fail for manual retry, the right choice for nodes with non-idempotent side effects)
   - `index.ts` — re-exports
2. **Register it** — one line in `lib/engine/nodes/registry.ts`.
3. **(Optional) UI panel** — add a panel component under `components/panels/` and
   register it (or the declarative kind's generic panel covers it automatically).

Everything else is automatic: node rows are created per flow from the registry, the workflow graph's layout/edges/labels come from `/api/graph` (registry-derived), retry re-validates the recorded input against the node's schema, chat routes to the node's `chat()`, and reconcile delegates recovery to the node's `recover()`.

Nodes are pluggable — the same engine can model other use cases (docs generation, release notes, QA) by registering a different node set.

## Notes

- **Plan fan-out (step sub-flows):** a node downstream of a plan with `fanout.mode != whole` runs one child flow per pending plan step (built-in `step-build` for build; every other kind auto-wraps itself as a hidden child template; the **`fanout_child` knob** explicitly picks a gallery template for the child on any fan-out-capable node — save-time lint keeps children one-node chains with no plan/pipeline/review/resolve/fan-out of their own, and a declared child start contract is validated against the `{plan, step, siblings}` payload exactly like a webhook delivery). Approving a step merges its branch into the parent's integration branch in a dedicated arena clone (`workspaces/<flowId>-arena`), serialized per branch. Conflicts and hook-rejected pushes go to a **bounded merge-fix agent** on the step branch (`max_merge_fix_attempts`, default 2) — the branch merges origin/integration locally and resolves conflicts respecting both intents, never rebased; a stale (diverged) branch is repaired by the same merge (the parent card shows a "stale base" chip). Exhaustion or infra failures fail the step visibly; Retry re-runs the merge (+ fix agent). Restarts mid-merge are recovered by the reconciler: stuck `step_merges` rows resume or fail loud, orphan children surface on the parent. Skipped steps delete their child's branch and sweep the child worktree.
- **Fan-out parallelism:** `fanout.parallel_max` (default 1 = sequential) lets file-disjoint siblings build concurrently — a step whose `files` overlap an in-flight sibling (or has no file list) always waits, and a failed *code* sibling keeps stalling its overlapping neighbours while failed non-code siblings release the rest. Merges still serialize per integration branch (FIFO lock; step order when approvals arrive in step order, out-of-order landings repaired by merge commits), and step children see a **live sibling context pack** (building / awaiting approval / merged / failed, output summaries for non-code children, merge state for code children) instead of the expand-time snapshot.
- **Who decides execution (whole vs per-branch):** the plan node's `execution_default` knob publishes the resolution into plan-meta on every plan version — `whole` fixed, or **`follow`**: the PLANNER decides per plan version (the plan prompt gains a small execution directive, the response's `execution` + `execution_rationale` are parsed leniently — missing/unknown ⇒ whole, never a parse failure) with sources `knob | planner | default | override` in `artifacts.meta.executionSource`. Under `follow`, a "steps" decision fans the plan's declared branches out as one child flow per branch via the split runtime (`build` consumes `split_consume: "source"` and honors the plan node's published `splitResolution` — explicit `whole`/`per-unit` on the build still beats it), scheduled by the branches' declared `dependsOn` + `split_parallel_max`; the panel shows the resolution at approve ("will execute: one child flow per branch (4 branches)") with an override control, and forcing whole/per-branch at approve writes an `override` into plan-meta. The legacy knob value `steps` (per-step child flows) is superseded, not deleted: old configs carrying it now resolve to the same per-branch fan-out, and the per-step `StepFlowManager` machinery remains but is dormant by default (build's fan-out knob stays `whole`).
- **Fan-out monitoring (Phase 4):** the parent panel's step cards show per-step **cost + duration** (the child flow's own billed runs — `cost n/a` before a child's first run lands) with a rollup line above them (`6 steps · 2 resolved · … · $1.33 · 4m 12s`); the graph subtitle rolls the same numbers up (`steps 3/6 · building · $0.42`) and the parent card's border reflects the AGGREGATE child state while the orchestrator row itself holds `running` — red when any step failed, warning while per-step approvals are pending, info while steps build, success once every child resolved and the final aggregate approval is up. The flow header's cost chip now includes the step children's runs (its tooltip breaks cost/duration down per step), and the home flow list shows a `6 steps · 2 merged` badge on rows with an in-progress fan-out. `npm run seed:demo:fanout` seeds a DEMO-143 flow mid fan-out (children at mixed states, sample cost data) so the monitoring surface can be sampled without running agents.
- **Push options / CI:** every engine-driven push carries `-o ci.skip` (with a plain fallback for hosts that reject push options) so engine merges and branch deletions never spawn CI. Agent-initiated pushes **cannot** carry push options — the merge-fix/commit-fix agent pushes the step branch itself, so repo-side CI rules scoped to step-branch patterns are the mitigation. Only the parent's FINAL approval creates the MR, whose pipeline is expected to run.

- Cursor Cloud Agents work directly against self-hosted GitLab repos (`repos[].url = https://gitlab.company.com/group/repo`) — no local checkout needed for agent runs; local clones are only for rendering diffs.
- Local mode runs the agent in-process via `@cursor/sdk` (`Agent.create({ local: { cwd } })`) in the repo's local path, so the agent can commit and push with your local git credentials. Auth comes from `CURSOR_API_KEY` (the SDK requires Node 22.13+). The `local_agent.sandbox` setting maps to `local.sandboxOptions.enabled`; `local_agent.force` maps to `send({ local: { force } })` to expire a wedged run before a follow-up. Unlike the old `cursor-agent` CLI over ACP, the SDK surfaces real per-run token usage, so local runs record tokens as well as duration/model. Build prompts instruct it to create a `bugfix/<ticket>-<id>` branch (`feature/` for stories — repos commonly enforce branch-name patterns via pre-receive hooks, which reject `cursor/...` names); fix/resolve runs check out the MR branch first (best effort). If the branch didn't get pushed (agent died, network), the MR step pushes it from the local checkout — trying the origin remote first, then the token-authed HTTPS URL.
- Every node run streams live assistant/thinking/tool events into the unified chat panel from the SDK's normalized `SDKMessage` stream (`run.stream()`) — the same event shape whether the agent runs locally or in a Cursor VM.
- **Restart resilience:** local runs execute in-process, so a dev-server restart leaves their nodes stuck in `running`. `lib/engine/reconcile.ts` re-syncs them from the SDK's own state rather than any process bookkeeping: a run this process still owns (the in-memory handle map, pinned on `globalThis` via `lib/singleton.ts` so Next dev route bundles can't split it) is genuinely alive and left alone; anything else is read back from the SDK's persisted local store (`Agent.getRun(...).status`), which is the ground truth for how the turn ended — a finished turn is recovered (plan text / build diff), an unfinished or unloadable run is failed so you can retry. The pipeline gate's server-side wait loop has no agent run while polling, so it stamps its node row each iteration — the reconciler treats a fresh stamp as alive; a stale one fails the node, and a retry re-reads the current head pipeline (an already-green pipeline finishes immediately). For cloud mode it asks the Cursor API and re-attaches the event stream for runs that are still going. A late-finishing run whose node was already failed/retried is ignored instead of resurrecting the node or double-stamping an artifact. All git commands have timeouts so an unreachable remote can never hang the page.
