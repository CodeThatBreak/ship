# DevFlow — Single-screen Developer SDLC Cockpit

One screen for a developer's whole SDLC: **Jira ticket → Plan → Build → Merge Request → CI/CD → AI Review → Comment resolution** — powered by Cursor agents (**cloud** or **local CLI**, per flow), Jira, and self-hosted GitLab (multiple instances supported).

## Execution modes: cloud vs local

Every flow runs its agent nodes (plan, build, fix, review, resolve) in one of two modes, chosen when the flow is created:

- **☁ Cloud** — [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent/api) run on Cursor infrastructure against the repo's cloud URL. Needs `CURSOR_API_KEY`.
- **💻 Local** — the locally installed `cursor-agent` CLI runs on this machine inside the repo's configured **local path**. Uses your `cursor-agent login` session (or `CURSOR_API_KEY`), your git credentials, and lets you watch/edit the agent's changes live in your own checkout. Follow-ups resume the same CLI session.

Set the default mode and local-agent options (auto-approve tools, sandbox, timeout) on the **Settings** page; override per ticket on the home page.

## Settings page (`/settings`)

- **Agent execution** — default cloud/local mode + local CLI options, plus the **default model** for agent runs (list comes from `cursor-agent models`, falling back to a built-in list when the CLI isn't installed; per-run overrides available on each node's run buttons and in the *Edit prompt & run* dialog). `DEFAULT_MODEL` env remains the final fallback. Also the **comment-resolution quiet period**: how long after the last new MR comment the Resolve node auto-starts (default 10 min; `RESOLVE_DELAY_MINUTES` env is the fallback when no value is saved). The resolve always waits for the pipeline step to pass first, regardless of this delay.
- **Repositories** — registry of your repos: `name`, `cloud_url` (any GitLab domain), `local_path` (needed for local mode + local diffs), `default_branch`. Local paths are validated (must be a git repo).
- **GitLab instances** — one entry per self-hosted GitLab domain (`base_url` + PAT with `api` scope). DevFlow picks the token whose domain matches each repo's cloud URL for API calls, MRs, CI polling, comments, and cloning. Repos on domains without an entry fall back to `GITLAB_BASE_URL`/`GITLAB_TOKEN` from `.env`, so existing single-instance setups keep working unchanged. Each instance has a **Test** button to verify auth.

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

- **Plan node** — Cursor agent (plan mode) reads the repo + ticket PRD + Figma links and drafts an implementation plan. Refine it in a loop; every iteration is versioned (`v1, v2, …`) and you can view/diff each version. Every plan also ends with a structured `plan-meta` block — an ordered **step checklist** (`{id, title, detail, files, branch}`) plus optional multi-branch decomposition. The checklist is extracted into an **editable UI**: toggle steps done, retitle/reword, add/delete steps, reorder — manual edits survive across refinements, and done steps stay done when a refinement keeps their id.
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

### Demo flow (showcases the structured plan / editable checklist)

```bash
npm run seed:demo          # insert a DEMO-142 ticket + flow, mid-review
npm run seed:demo:reset    # remove it
```

Seeds a flow with a realistic PRD, a 2-version plan history (v1 multi-branch →
v2 refined single-branch), and the checklist mid-flight: two steps done by hand,
two checked off by a trial build run, one added manually, and one superseded by
the refine. Open the flow and try toggling / editing steps — it's all live data.

### `.env`

| Key | What |
|---|---|
| `CURSOR_API_KEY` | Cursor dashboard → API Keys. Powers every agent node. |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Jira (self-hosted or Cloud). `JIRA_JQL` controls which tickets load. |
| `GITLAB_BASE_URL` / `GITLAB_TOKEN` | Self-hosted GitLab PAT with `api` scope. |
| `GITLAB_WEBHOOK_SECRET` | Shared secret for the webhook endpoint. |
| `RESOLVE_DELAY_MINUTES` | Minutes of comment quiet before the Resolve node auto-starts (default `10`). Overridden by the Settings page value. |

### GitLab webhook (for live CI + comment triggers)

Project → **Settings → Webhooks**:
- URL: `https://<this-app-host>/api/webhooks/gitlab`
- Secret token: your `GITLAB_WEBHOOK_SECRET`
- Triggers: **Comments**, **Merge request events**, **Pipeline events**

> Webhooks need a publicly reachable URL. For local dev use `ngrok http 3000`, or rely on the built-in **30s poller** (no webhook needed) — it watches pipeline status + MR discussions and drives the same fix/resolve loop.

## Using it

1. Register your repos (and extra GitLab domains) on the **Settings** page.
2. **Sync Jira tickets** on the home page.
3. Pick a repo + execution mode (☁ Cloud / 💻 Local) for the ticket, click **▶ Build ticket** → a flow is created.
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
  interval, with ticket/repo binding). Node positions persist as you drag;
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
  page.tsx              ticket list + start flow (repo + mode picker)
  settings/page.tsx     repos registry, GitLab instances, execution defaults
  flows/[id]/page.tsx   the single-screen cockpit
  templates/            template gallery + the visual builder (drag-drop canvas
                        over the template graph, node/edge drawers)
  api/                  tickets, flows, actions, events, comments, webhook, hooks, repos, gitlab-instances,
                        settings, models, graph, templates (+import/export), node-templates, contracts
components/             WorkflowGraph, PlanView, DiffView, ReviewView, NodePanel + ai-elements/ (AI Elements: Conversation, Message, Reasoning, Tool, PromptInput, Response, Loader)
components/template-editor/  visual builder (BuilderCanvas on @xyflow/react), NodeConfigurator (Trigger/Config/Contract), AddNodeDialog

lib/                    strict OOP: every module is a class with one responsibility, exported as a
                        shared singleton (db, flowEngine, nodeRegistry, gitLab, cursorClient, …)
  config.ts             AppConfig — env-sourced config grouped by integration (cursor/jira/gitlab/db/workspace)
  utils.ts              Styles — Tailwind-aware className merging (`cn` alias for components)
  groupEvents.ts        EventGrouper — folds the flat event list into run sections for the unified chat panel
  integrations/         cursorSdk.ts CursorAgentService — unified agent runtime over @cursor/sdk,
                        driving both cloud (Cursor-hosted VM) and local (in-process agent loop) runs
                        behind one streaming/usage/result path; cursor.ts CursorClient (cloud adapter)
                        and localAgent.ts LocalAgentService (local adapter: branch checkout, settings)
                        are thin shims over it. jira.ts JiraClient (ADF→text, Figma/PRD extraction),
                        gitlab.ts GitLabService + GitLabClient (multi-domain, per-repo token resolution)
  engine/
    flow.ts             FlowEngine — orchestration only: triggers, approvals (build approval runs
                        MR creation with commit-fix retries → pipeline gate → review), retry/cancel,
                        webhook ingest. Knows nothing about individual nodes; everything goes through
                        the registry.
    nodes/
      keys.ts           NODE_KEYS — stable node-key constants (use these, not string literals).
      base/             shared node infrastructure, one class per file:
        node-definition.ts  NodeDefinition (abstract): key/label/order/edges + Zod inputSchema/
                            outputSchema + run/chat/recover, with shared services injected.
        agent-runner.ts     AgentRunner — startAgent/executeRun: agent start, streaming, cost capture.
        flow-context.ts     FlowContextHelper — mode/branch/diff facts about a flow context.
        node-support.ts     NodeSupport — row/artifact/run persistence helpers.
        stream-buffer.ts    StreamBuffer — buffered thinking/assistant event flushing.
        tool-pairer.ts      ToolPairer — tool-call start/end pairing for local mode.
        usage-tracker.ts    UsageTracker — token-usage and cost accounting.
      plan/             PlanNode — plan prompt, plan-meta parse/validate (plan-meta-parser.ts),
                        checklist sync, plan recovery; schema.ts holds the Zod schemas.
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
      registry.ts       NodeRegistry — the single source of truth: node map, graph order, edges, labels.
    prompts.ts          PromptLibrary — prompt templates (customizable via settings)
    steps.ts            PlanStepStore — structured plan checklist: plan-meta sync, edits, build-progress
    poller.ts           FlowPoller — 30s poll: pipeline status + MR discussions → pipeline-gate triggers;
                        new comments queue the resolve via FlowEngine.scheduleResolve (quiet-period
                        debounce + pipeline gate — processResolveSchedules fires them from the tick)
    reconcile.ts        Reconciler — re-sync stuck `running` nodes with real run state on flow open/poll
  git/local.ts          LocalGit — clone/diff/push/worktrees; uses the repo's local checkout when
                        registered, per-domain tokens
  db/
    schema.sql          tables (tickets, flows, nodes, artifacts, comments, events, runs, plan_steps,
                        branches, repos, gitlab_instances, settings)
    index.ts            Database — better-sqlite3 connection + migrations, query helpers (get/all/run),
                        settings, repos, events, messages
    rows.ts             Zod schemas for every table row + RowGateway (get/all) — rows are validated
                        once at the DB boundary, so consumers never see `any` or raw JSON strings.
data/devflow.db         local SQLite (server-ready: swap for Postgres later)
workspaces/             local clones used for diffs (cloud mode; local mode diffs in the registered checkout)
```

**Multi-user-ready:** all state is per-flow/per-ticket in the DB. To go multi-user, add auth, scope queries by user, and swap SQLite for Postgres — the engine is stateless across requests.

## Adding a new node type

The workflow is a registry of `NodeDefinition` classes — one folder per node type in `lib/engine/nodes/`. To add one:

1. **Create the node folder** — `lib/engine/nodes/<name>/` with:
   - `schema.ts` — strict Zod `inputSchema` (everything a run needs — validated on trigger **and** on retry) and `outputSchema` (what gets persisted to the node's `output` column)
   - `<name>-node.ts` — the node class extending `NodeDefinition<I, O>` from `nodes/base`: declare `key` (from `NODE_KEYS` in `keys.ts`), `label`, `order` (graph position), `edges` (graph connections), and `promptKeys`; implement `run(ctx, input)` — usually via the base `execute()` helper, which handles status/input persistence, agent start (cloud/local), streaming, cost capture, artifact saving, output validation, and the lifecycle event; optionally override `chat()` (follow-up runs on the node's agent) and `recover()` (how to finish a run that completed while the server was down — return `false` to fail for manual retry, the right choice for nodes with non-idempotent side effects)
   - `index.ts` — re-exports
2. **Register it** — one line in `lib/engine/nodes/registry.ts`.
3. **(Optional) UI panel** — add a panel branch in `components/NodePanel.tsx` and an icon in `components/WorkflowGraph.tsx`.

Everything else is automatic: node rows are created per flow from the registry, the workflow graph's layout/edges/labels come from `/api/graph` (registry-derived), retry re-validates the recorded input against the node's schema, chat routes to the node's `chat()`, and reconcile delegates recovery to the node's `recover()`.

Nodes are pluggable — the same engine can model other use cases (docs generation, release notes, QA) by registering a different node set.

## Notes

- Cursor Cloud Agents work directly against self-hosted GitLab repos (`repos[].url = https://gitlab.company.com/group/repo`) — no local checkout needed for agent runs; local clones are only for rendering diffs.
- Local mode runs the agent in-process via `@cursor/sdk` (`Agent.create({ local: { cwd } })`) in the repo's local path, so the agent can commit and push with your local git credentials. Auth comes from `CURSOR_API_KEY` (the SDK requires Node 22.13+). The `local_agent.sandbox` setting maps to `local.sandboxOptions.enabled`; `local_agent.force` maps to `send({ local: { force } })` to expire a wedged run before a follow-up. Unlike the old `cursor-agent` CLI over ACP, the SDK surfaces real per-run token usage, so local runs record tokens as well as duration/model. Build prompts instruct it to create a `bugfix/<ticket>-<id>` branch (`feature/` for stories — repos commonly enforce branch-name patterns via pre-receive hooks, which reject `cursor/...` names); fix/resolve runs check out the MR branch first (best effort). If the branch didn't get pushed (agent died, network), the MR step pushes it from the local checkout — trying the origin remote first, then the token-authed HTTPS URL.
- Every node run streams live assistant/thinking/tool events into the unified chat panel from the SDK's normalized `SDKMessage` stream (`run.stream()`) — the same event shape whether the agent runs locally or in a Cursor VM.
- **Restart resilience:** local runs execute in-process, so a dev-server restart leaves their nodes stuck in `running`. `lib/engine/reconcile.ts` re-syncs them from the SDK's own state rather than any process bookkeeping: a run this process still owns (the in-memory handle map, pinned on `globalThis` via `lib/singleton.ts` so Next dev route bundles can't split it) is genuinely alive and left alone; anything else is read back from the SDK's persisted local store (`Agent.getRun(...).status`), which is the ground truth for how the turn ended — a finished turn is recovered (plan text / build diff), an unfinished or unloadable run is failed so you can retry. The pipeline gate's server-side wait loop has no agent run while polling, so it stamps its node row each iteration — the reconciler treats a fresh stamp as alive; a stale one fails the node, and a retry re-reads the current head pipeline (an already-green pipeline finishes immediately). For cloud mode it asks the Cursor API and re-attaches the event stream for runs that are still going. A late-finishing run whose node was already failed/retried is ignored instead of resurrecting the node or double-stamping an artifact. All git commands have timeouts so an unreachable remote can never hang the page.
