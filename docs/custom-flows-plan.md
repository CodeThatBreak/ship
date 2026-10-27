# Custom Flows & Custom Nodes — Implementation Plan

Date: 2026-10-23 (rev 2 — review feedback incorporated) · Status: approved direction, pending implementation

## Goal

Let users build their **own flows** by composing nodes: the five built-in SDLC nodes
(plan, build, pipeline, review, resolve) stay available with their code-level logic, and
users add **custom nodes** (agent / http / script / decision) arranged into **flow
templates** — editable via UI *and* config-as-code (YAML). Audience is individual devs
running DevFlow locally / self-hosted; multi-user auth is out of scope.

## Locked decisions (from design discussion 2026-10-23)

| Decision | Choice |
|---|---|
| Node kinds | `builtin` + `agent`, `http`, `script`, `decision` (declarative) |
| Flow building model | **Template library** — flows instantiate from templates and snapshot their node set; running flows are never mutated by template edits |
| Audience | Individual devs, local/self-hosted (scripts run with user trust, like `npm run`) |
| Builder UX | **Both** config-as-code (YAML import/export) and UI builder — one data model, two views |
| Built-in nodes | Configurable via typed **config knobs** (three layers), internals never configurable |
| Contracts | Every node declares input/output schemas, **visible in the node configurator**, statically validated at build time |
| Triggers | First-class: flow triggers (manual / webhook / schedule) + node triggers (`auto`/`manual`/`approval`/`debounced`) + node `wait_for` event sources (gitlab_pipeline / gitlab_comments / webhook / timer) |
| Orchestration | **Keep our own engine** (Cursor-agent integration is the differentiator); borrow libraries for expressions/sandboxing, never the core |

---

## 1. Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│ Template layer (design time)                                       │
│  node_templates      — catalog of node types (built-in + custom)   │
│  flow_templates      — named flows (graph + per-node config)       │
│  flow_template_nodes — node instances: trigger, join, config, map  │
│  flow_template_edges — edges: kind, label (decision), condition    │
│  UI builder  ⇆  DB rows  ⇆  YAML import/export                     │
├────────────────────────────────────────────────────────────────────┤
│ Runtime layer (execution time)                                     │
│  flows.template_id  — which template this flow snapshot            │
│  nodes              — per-flow instance rows (config merged +      │
│                        snapshotted, join_mode, status + skipped)   │
│  FlowEngine         — edge-driven DAG traversal replaces           │
│                        hardcoded chains in lib/engine/flow.ts      │
│  NodeDefinition     — unchanged contract for built-ins; one        │
│                        generic runtime class per declarative kind  │
├────────────────────────────────────────────────────────────────────┤
│ Trigger layer                                                      │
│  /api/webhooks/gitlab — existing, domain-smart (unchanged)         │
│  /api/hooks/<id>      — generic inbound webhooks (standardwebhooks)│
│  hooks table        — secrets, JSONata filters, flow/node binding  │
│  FlowPoller         — also drives schedule triggers + timers       │
└────────────────────────────────────────────────────────────────────┘
```

### Three layers of built-in configurability

1. **Wiring** (per template instance) — trigger type, edges, join mode, approval gates.
   Lives on `flow_template_nodes` / `flow_template_edges`, never in the class.
2. **Config knobs** (per node class) — typed `configSchema` (Zod) + `configFields`
   descriptors that drive an auto-generated form. Effective config merges four layers,
   validated at each:
   `class defaults ← app settings ← template node config ← flow instance config`
3. **Internals** — never configurable (MR commit-fix classification, pipeline head
   re-reading, plan-meta parsing). That's the contract of a built-in.

**Prompt overrides fold into config**: the existing `prompt_templates` settings mechanism
becomes "the prompt-body knob at the app-settings layer" (same `internalSuffix`
protection), now also overridable per-template and per-flow. `RESOLVE_DELAY_MINUTES`
migrates to the resolve node's `quiet_minutes` knob the same way.

**Discipline: every knob's default equals current behavior** — the zero-behavior-change
guarantee `PromptLibrary` DEFAULTS already enforces. New knobs are added only when a real
template needs them.

---

## 2. Data model

All new tables created in an idempotent migration in `db/migrate()` (same pattern as
existing migrations in `lib/db/index.ts`).

```sql
-- Node type catalog: built-ins (seeded) + user-defined declarative nodes
CREATE TABLE IF NOT EXISTS node_templates (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,              -- builtins use NODE_KEYS values
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- builtin | agent | http | script | decision
  version      INTEGER NOT NULL DEFAULT 1,
  description  TEXT,
  icon         TEXT,                       -- lucide icon name for the graph
  config       TEXT NOT NULL DEFAULT '{}', -- declarative kinds: full definition;
                                           -- builtin: knob overrides only
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(key, version)
);

-- Flow templates
CREATE TABLE IF NOT EXISTS flow_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  trigger      TEXT NOT NULL DEFAULT '{"type":"manual"}',  -- flow trigger JSON
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Node instances within a template
CREATE TABLE IF NOT EXISTS flow_template_nodes (
  id               TEXT PRIMARY KEY,
  template_id      TEXT NOT NULL REFERENCES flow_templates(id),
  node_key         TEXT NOT NULL,          -- instance key, unique per template
  node_template_id TEXT NOT NULL REFERENCES node_templates(id),
  label            TEXT,                   -- display name override
  trigger          TEXT NOT NULL DEFAULT '{"type":"auto"}',
  join_mode        TEXT NOT NULL DEFAULT 'all',   -- all | any
  config           TEXT NOT NULL DEFAULT '{}',    -- knob overrides
  input_map        TEXT NOT NULL DEFAULT '{}',    -- {field: JSONata expr}
  x                REAL, y REAL,                  -- graph editor positions
  UNIQUE(template_id, node_key)
);

-- Edges within a template
CREATE TABLE IF NOT EXISTS flow_template_edges (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES flow_templates(id),
  from_key     TEXT NOT NULL,
  to_key       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'next',  -- next | loop
  label        TEXT,                          -- decision edge label
  condition    TEXT,                          -- optional JSONata expression
  UNIQUE(template_id, from_key, to_key, label)
);

-- Generic inbound webhook endpoints
CREATE TABLE IF NOT EXISTS hooks (
  id           TEXT PRIMARY KEY,            -- /api/hooks/<id>
  template_id  TEXT REFERENCES flow_templates(id),  -- set ⇒ starts a new flow
  flow_id      TEXT REFERENCES flows(id),           -- set ⇒ feeds a waiting node
  node_key     TEXT,
  secret       TEXT NOT NULL,
  filter       TEXT,                        -- optional JSONata boolean filter
  created_at   TEXT NOT NULL
);

-- Existing tables:
-- flows  += template_id TEXT, trigger_payload TEXT (JSON)
-- nodes  += label TEXT, config TEXT (effective config snapshot), join_mode TEXT
-- nodes.status gains 'skipped'
```

---

## 3. Engine semantics (the core refactor)

`lib/engine/flow.ts` today *is* the wiring (`approvePlan → BUILD`,
`afterPipelineGate → REVIEW → RESOLVE`, `NODE_KEYS` at ~30 call sites). It becomes an
edge-driven DAG executor that knows **no node keys**.

### Node statuses

`pending | waiting | running | awaiting_approval | approved | done | failed | skipped`
(`waiting` = eligible but `wait_for` event pending; `skipped` = on a non-taken branch).

### Trigger types (per template node instance)

| Type | Behavior |
|---|---|
| `auto` | Runs as soon as join is satisfied |
| `manual` | Becomes eligible; user clicks run (today's plan start) |
| `approval` | Runs when eligible, then holds at `awaiting_approval`; outgoing edges activate on approve (today's plan/build) |
| `debounced` | Eligible events schedule a run after `minutes` of quiet; each new event resets the timer (today's resolve quiet period) |

### Edge activation

When a node reaches a success terminal state (`done`, or `approved` for
approval-triggered nodes), evaluate each outgoing edge:

- `condition` (JSONata over flow context) absent or truthy ⇒ **active**
- `kind: loop` ⇒ re-triggers the target (bounded by the target's max-attempts knob),
  preserving today's pipeline-fix and review↔resolve loops
- decision node ⇒ activates exactly the edges whose `label` ∈ `output.chosen`;
  all other outgoing edges resolve **inactive**

### Join evaluation

- `all` (default): node becomes eligible when every incoming edge is resolved
  (active or inactive); at least one must be active, else the node is `skipped`
- `any`: node becomes eligible on the first active incoming edge
- `skipped` propagates: a skipped node's outgoing edges resolve inactive

### Input mapping

Each template node's `input_map` is `{inputField: "<JSONata expression>"}` evaluated
against the flow context at trigger time:

```jsonc
{
  "ticket":  { "key": "...", "summary": "...", "prd": "..." },
  "repo":    { "cloud_url": "...", "local_path": "..." },
  "trigger": { "payload": { /* webhook body */ } },
  "nodes":   { "<key>": { "output": { /* validated contract */ } } },
  "flow":    { "mr_url": "...", "mr_branch": "..." }
}
```

The mapped result is validated by the node's `inputSchema` (existing `parseInput`).

### What survives from today's flow.ts

`bg()` fire-and-forget wrapper, `runNode()` (registry get + parseInput + run),
retry/cancel, reconcile, webhook ingest, resolve scheduling — all node-key-agnostic
already, or made so by routing through the template graph instead of `NODE_KEYS`.

---

## 4. Node kind specs

### 4.1 `builtin` — existing five classes, plus config

`NodeDefinition<I, O, C>` gains:

```ts
abstract readonly configSchema: z.ZodType<C>;
readonly configFields: ConfigField[] = [];   // {key, label, type, help} → auto form
defaultConfig(): C { return this.configSchema.parse({}); }
abstract run(ctx: FlowCtx, input: I, config: C): Promise<RunOutcome>;
```

**Starting knob inventory** (defaults = today's behavior, always):

| Node | Knobs |
|---|---|
| plan | `prompt_body`, `default_complex` (bool), `decompose_default` (bool) |
| build | `prompt_body`, `branch_pattern` (e.g. `bugfix/{ticket}-{id}`), `max_commit_fix_attempts` |
| pipeline | `fix_prompt_body`, `max_fix_attempts`, `poll_interval_sec`, `play_manual_jobs` (bool), `auto_trigger_pipeline` (bool), `gate_timeout_min` |
| review | `prompt_body`, `max_comments`, `comment_style` (`inline` \| `summary`) |
| resolve | `prompt_body`, `quiet_minutes` (migrates `RESOLVE_DELAY_MINUTES`), `max_regate_loops` |

### 4.2 `agent` — declarative prompt node (first custom kind)

A single `AgentTemplateNode` runtime class wraps any `node_templates` row with
`kind='agent'`. Config:

```jsonc
{
  "prompt": "Draft release notes for {{ticket.summary}} …",   // PromptLibrary-style {{vars}}
  "mode": "plan",                 // plan | agent
  "model": null,                  // null = flow/default model
  "output": "markdown",           // markdown | json
  "output_schema": null           // when output=json: JSON Schema the agent must satisfy
}
```

Execution reuses `PromptLibrary` rendering + `AgentRunner` + the base `execute()`
lifecycle (status, streaming, cost, artifacts, validation) — no new infrastructure.
Contract: inputs declared in the editor (field list); output is either markdown
(saved as an artifact — passed on via prompt variables) or JSON validated against
`output_schema` (addressable as `{{nodes.<key>.output.<field>}}`). `chat()` works via
the base `converse()`.

### 4.3 `decision` — conditional branching

```jsonc
{
  "source": "expression",   // expression | manual | agent
  "expression": "nodes.review.output.comment_count > 0 ? ['fix'] : ['ship']",
  "question": "Given the review outcome, fix or ship?",        // agent source only
  "choices": [
    { "label": "fix",  "description": "Genuine issues worth fixing now" },
    { "label": "ship", "description": "Nits only — merge as-is" }
  ]
}
```

Output contract (fixed): `{ chosen: string[], rationale?: string }`. Sources:

- **`expression`** — JSONata over the flow context; fully deterministic.
- **`manual`** — reuses the approval UI: the user picks a branch instead of approving.
- **`agent`** — an agent classifies the flow state into one choice. The UX is designed
  to keep the agent honest and the user in control:
  - The prompt is **auto-built, not free-form**: the user writes a `question` plus a
    per-choice `description` — descriptions are how the user steers the classifier
    without prompt engineering.
  - The agent runs in **plan mode** (read-only judgment, no code changes) and must
    return constrained structured output `{"choice": "<one of the labels>",
    "rationale": "..."}`, validated against a Zod enum schema. An invalid or
    ambiguous answer **fails the node** (normal retry path) — the engine never
    silently picks a branch.
  - The node panel shows a **decision card** — chosen branch + rationale — and the
    taken edge highlights in the graph. What was decided and why is never buried in
    run logs.
  - **Oversight is just the trigger type**: with `trigger: approval` the agent
    *proposes* and the user *disposes* — the approval UI shows the agent's pick
    pre-selected with its rationale, one click to confirm or override. With
    `trigger: auto` it fires unattended. Same node, same code path.
  - Pushback is the existing chat: "you missed that those tests are flaky" →
    follow-up run on the same agent → revised decision.

### 4.4 `http` — outbound request node

```jsonc
{
  "url": "{{secrets.SLACK_WEBHOOK}}",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{ \"text\": \"{{nodes.draft.output.summary}}\" }",
  "timeout_ms": 30000,
  "response_map": "{ \"ok\": status = 200, \"body\": body }"
}
```

- `{{secrets.NAME}}` interpolates from the settings store (new `secrets` settings key),
  never persisted into node rows or events — resolved at execution time only.
- Output contract (fixed): `{ status: number, ok: boolean, body: any, headers: object }`
  shaped by `response_map` (JSONata).
- **SSRF guard** (own ~80-line util, `lib/net/ssrf-guard.ts`): scheme http/https only;
  hostname allowlist from settings (`http_allowlist`, empty = deny-by-default for
  template-authored nodes); DNS-resolve once, check *every* resolved IP with
  `ipaddr.js` (loopback/private/link-local/CGNAT/multicast), pin the resolved IP for
  the request, re-validate on every redirect hop. Do **not** use `ip-address` (CVE-2026-69192)
  or `private-ip` (multicast bypass); parser differentials are the failure mode, so the
  guard pins the IP it checked.

### 4.5 `script` — local script node

```jsonc
{
  "runtime": "shell",           // shell | node | python
  "script": "jq '.version' package.json",
  "cwd": "repo",                // repo local_path | workspace
  "timeout_ms": 120000,
  "env": ["CI", "NODE_ENV"]     // env var allowlist passed through
}
```

Contract: mapped input JSON arrives on stdin (and as `DEVFLOW_INPUT`); the script's
**last stdout line must be the output JSON** (or it writes `$DEVFLOW_OUTPUT` file),
validated against the user-declared output schema. Execution via **execa** (promise API,
zombie cleanup, cross-platform). v1 runs trusted with user permissions (local/self-hosted
= same trust as `npm run`). Later rungs on the sandbox ladder: `@formio/vm`
(quickjs-emscripten / isolated-vm backends) for JS-only sandboxed scripts, or Deno
subprocess (`deno run --no-net …`) as an optional permission-flagged runtime.
**Never `vm2`** (CVE-2026-22709, CVSS 9.8, Jan 2026) and never `node:vm` for untrusted
code ("not a security mechanism" — node docs).

---

## 5. Contracts in the node configurator

Every node — built-in or custom — exposes its contract in the configurator UI:

```
┌ Node: triage (agent) ──────────────────────────
│ [Trigger]  [Config]  [Contract]
│   Inputs — what this node needs
│     summary : string  ← {{trigger.payload.issue.title}} ✓
│     stack   : string  ← {{trigger.payload.stacktrace}}  ✓
│   Outputs — published to the flow
│     severity : enum[low, med, high]
│     markdown : string → saved as artifact
```

- Zod schemas → JSON Schema via `zod-to-json-schema` for display + autocomplete.
- Input mapping fields autocomplete from **upstream contracts** (DAG ⇒ "upstream" is
  well-defined) + `{{trigger.payload}}` + flow context.
- **Data passing is variables-only (v1)**: `input_map` maps template variables only.
  Outputs are small structured data addressable as `{{nodes.X.output.Y}}`; large
  content (plans, diffs, docs) stays in artifacts and reaches prompts through prompt
  variables exactly as today (`{{plan}}`, `{{diff}}`) — no artifact references in
  input maps yet.
- **Three validation points**: build time (every `{{nodes.X.output.Y}}` reference
  statically resolves + type-checks in the editor), trigger time (`parseInput`,
  existing), persist time (`parseOutput`, existing — node fails loudly, downstream
  never consumes garbage).

### 5.1 Start contract + the variable UX (implemented, 2026-10-24)

**The Start node has a contract** — one field list (key / type / required /
default, declared on the start instance's config) that serves as input AND
output: whatever the trigger provides is validated against it and published as
the start node's output, so every downstream node maps from those variables.
Who provides the values follows the start node's trigger type:

| Trigger | Who provides the values |
|---|---|
| `auto` | the authored field defaults (published when the flow starts) |
| `manual` / `approval` | the user fills the form when triggering (the start node's runtime panel; an approval-trigger start holds for the user instead of running to a hold) |
| webhook flow trigger | the delivery payload must match the contract — unknown fields are rejected, missing required fields fail; `startFromTemplate` validates before creating the flow, so the sender gets a 400 with the exact mismatch |

Implementation: `lib/engine/nodes/start/contract.ts` (pure zod + coercion +
validation, shared by the runtime class, `/api/contracts` (per-instance via
`?config=`), `context-lint` (start contract fields are addressable
`{{nodes.start.output.<field>}}` refs; the declaration itself is linted), and
`/api/graph` (`meta[key].outputs` — the graph cards show the published
variables). The start runtime panel renders the contract form (prefilled with
the last run's values, then the authored defaults) + the published variables.

**Friendly variable UX**: the pickers show just the variable names grouped by
upstream node ("Review · comment_count") — the raw `{{nodes.X.output.Y}}` refs
stay engine plumbing; free-text config fields (prompt / url / body / question)
get click-to-insert variable chips built from the same upstream contracts.

---

## 6. Trigger system

### Flow triggers

| Type | Mechanism |
|---|---|
| `manual` | Today's ticket picker → "Build ticket" (template selectable) |
| `webhook` | `POST /api/hooks/<hook_id>`; payload → `{{trigger.payload}}`; optional JSONata `filter`; creates flow from the bound template |
| `schedule` | `{"type":"schedule","interval_min":N}`; FlowPoller's 30s tick fires due schedules |

### Node `wait_for` event sources

| Source | Semantics |
|---|---|
| `gitlab_pipeline` | Today's pipeline-gate wait (head re-read, manual-job play) — built-in, unchanged |
| `gitlab_comments` | Today's comment watch + quiet period — built-in, unchanged |
| `webhook` | Generic hook row bound to (flow, node); matching payload resumes the node, payload available in input mapping |
| `timer` | `{"minutes": N}` — resume after delay (poller-driven) |

### Generic inbound webhooks

- Endpoint `app/api/hooks/[id]/route.ts`; hooks row holds the secret.
- Verification: `standardwebhooks` when the sender follows the spec
  (`webhook-id`/`webhook-timestamp`/`webhook-signature` — OpenAI, Anthropic, Supabase
  format); otherwise shared-secret header fallback with constant-time compare.
  Provider-specific schemes (GitLab token header, GitHub/Sentry HMAC) stay as tiny
  per-provider verifiers; the existing `/api/webhooks/gitlab` route is untouched.
- Dedup by `webhook-id` header when present (table of seen ids per hook, TTL'd);
  1 MB payload cap; raw-body read (signature verification is body-sensitive).

---

## 7. The built-in SDLC loop as a template (proof of the model)

Seeded at migration time; `FlowEngine.create()` instantiates from it. If the engine
can express today's loop as data, the model is right:

```yaml
# seeded built-in template: "SDLC loop"
trigger: { type: manual }
nodes:
  - key: plan
    type: builtin/plan
    trigger: { type: manual }
    after_approval: [build]
  - key: build
    type: builtin/build
    trigger: { type: approval }
  - key: pipeline
    type: builtin/pipeline
    trigger: { type: auto }
    wait_for: gitlab_pipeline
  - key: review
    type: builtin/review
    trigger: { type: auto }
  - key: resolve
    type: builtin/resolve
    trigger: { type: debounced, minutes: 10 }   # quiet_minutes knob default
    wait_for: gitlab_comments
edges:
  - [plan, build]
  - [build, pipeline]        # MR creation stays inside build approval (MergeRequestService)
  - [pipeline, review]
  - [review, resolve]
  - [resolve, pipeline, { kind: loop }]   # re-gate after code changes
  - [pipeline, build, { kind: loop, label: ci-fix }]  # bounded fix attempts
```

And a custom flow exercising everything new:

```yaml
# flow-templates/sentry-triage.yaml — importable
name: Sentry triage
trigger:
  type: webhook
  filter: "payload.event = 'issue.created'"
nodes:
  - key: triage
    type: agent
    trigger: { type: auto }
    config:
      prompt: "Triage this Sentry issue. Output JSON: {severity, summary, suggested_fix}."
      output: json
      output_schema:
        type: object
        required: [severity, summary]
        properties:
          severity: { enum: [low, med, high] }
          summary: { type: string }
          suggested_fix: { type: string }
    input_map:
      summary: "trigger.payload.issue.title"
      stack: "trigger.payload.issue.stacktrace"
  - key: worth_fixing
    type: decision
    trigger: { type: approval }          # agent proposes, human disposes
    config:
      source: agent
      question: "Given the triage result, is this issue worth an automated fix PR?"
      choices:
        - { label: fix,    description: "Real user-facing bug with a plausible localized fix" }
        - { label: ignore, description: "Noise, duplicate, or too risky to auto-fix" }
  - key: open_pr
    type: agent                    # an agent node with repo access in agent mode
    trigger: { type: auto }
    config:
      mode: agent
      prompt: "Fix the issue: {{nodes.triage.output.suggested_fix}}"
  - key: notify
    type: http
    trigger: { type: auto }
    config:
      url: "{{secrets.SLACK_WEBHOOK}}"
      method: POST
      body: "{ \"text\": \"Triaged {{ticket.key}}: {{nodes.triage.output.summary}}\" }"
edges:
  - [triage, worth_fixing]
  - [worth_fixing, open_pr, { label: fix }]
  - [triage, notify]               # notify always; open_pr skipped when 'ignore'
```

---

## 8. UI surface

| Surface | Phase | What |
|---|---|---|
| Template gallery `/templates` | 2 | List, create, duplicate built-in, import/export YAML, delete |
| Template editor | 2 | Step-list editor (ordered nodes, per-node trigger/join, edge list w/ labels+conditions); positions stored for the graph view |
| Node configurator | 2 | Three tabs: **Trigger** (type, wait_for, debounce), **Config** (schema-driven form from `configFields` / declarative definition), **Contract** (inputs table with mapping autocomplete + outputs table) |
| Runtime generic node panel | 2 | For declarative nodes in `components/NodePanel.tsx`: prompt view/edit, run button + model picker, markdown/JSON output viewer, approval button, "Configure" popover (instance config → `nodes.config`) |
| Graph icons | 2 | `components/WorkflowGraph.tsx` reads icon from node_templates; dagre layout unchanged |
| `/api/graph` | 1 | Derives from the flow's template instead of the global registry |
| Visual graph builder | 5 | Drag to add/connect/reorder on the existing dagre graph |
| Flow start UX | 2 | Template picker on the home page (default: SDLC loop) |

---

## 9. Dependencies

| Package | License | Purpose |
|---|---|---|
| `execa` ^9 | MIT | script node process execution |
| `standardwebhooks` ^1 | MIT | generic inbound webhook verify (+ outbound signing later) |
| `jsonata` ^2 | MIT | decision conditions, edge conditions, input mapping, http response_map |
| `ipaddr.js` ^2 | MIT | SSRF guard IP classification |
| `yaml` ^2 | ISC | config-as-code templates |
| `zod-to-json-schema` ^3 | ISC | contracts → configurator UI |
| `@formio/vm` (later, optional) | Apache-2.0 | sandboxed JS scripts (quickjs-emscripten / isolated-vm backends) |

Explicitly rejected: `vm2` (broken security), `node:vm` (not a boundary),
`ip-address` / `private-ip` (2026 SSRF CVEs), n8n (fair-code, can't embed),
Windmill (AGPL), Svix/Convoy/Outpost (gateway services — overkill for local).
Activepieces (MIT) is reference material for HTTP-node UX, not a dependency.

---

## 10. Phased implementation

### Phase 1 — Engine foundation: graph from DB (no UX change)

*Riskiest step, done first and alone. The app must behave identically throughout.*

- **1A.** Migration: new tables (§2); seed `node_templates` for the five built-ins;
  seed the SDLC `flow_templates` graph (§7 YAML as rows). `nodes` += `label`,
  `config`, `join_mode`; `flows` += `template_id`, `trigger_payload`; add `skipped`
  status handling everywhere statuses are consumed.
- **1B.** `TemplateStore` (`lib/engine/templates.ts`): template CRUD + instantiation.
  `FlowEngine.create()` takes `templateId` (default SDLC) and snapshots node rows from
  `flow_template_nodes` (merged config baked in) instead of `nodeRegistry.all()`.
- **1C.** Edge-driven traversal in `flow.ts`: a single `advance(flowId, nodeKey)`
  replaces `approvePlan`'s build kick-off, `approveBuild`'s MR→pipeline chain entry,
  and `afterPipelineGate`'s review/resolve sequencing — it activates outgoing edges,
  evaluates joins, and triggers targets per trigger type. Existing public methods
  (`startPlan`, `refinePlan`, `retryNode`, `scheduleResolve`, …) keep their signatures
  and delegate. `NODE_KEYS` references removed from `flow.ts` (poller/webhook/reconcile
  addressed by role: "the node with `wait_for: gitlab_pipeline`", not the key
  `pipeline`).
- **1D.** Config layers: `configSchema`/`configFields` on `NodeDefinition`; merge
  resolver (`lib/engine/node-config.ts`); migrate `prompt_templates` settings and
  `RESOLVE_DELAY_MINUTES` into app-layer node config.
- **Acceptance:** both seed-demo scripts produce flows that run end-to-end identically;
  `/api/graph` renders the same graph; retry/chat/reconcile/poller paths unchanged in
  behavior; `git grep NODE_KEYS lib/engine/flow.ts` → 0 hits.
- **Status (implemented):** done as specified, with one documented deviation — the
  seeded template's edges are `resolve → review { kind: loop }` (not `resolve →
  pipeline`), and the `pipeline → build { kind: loop, ci-fix }` edge is not seeded:
  in Phase 1 all `loop` edges are **display metadata**; today's runtime loops (the
  faithful inline gate→review→resolve-if-open→re-gate chain and the bounded commit-fix
  retry inside MR creation) are kept verbatim in the engine, bounded by the new
  `max_regate_loops` / `max_commit_fix_attempts` knobs. When §3 edge conditions land
  (Phase 3), those inline loops convert to conditional loop edges and the seeds
  become authoritative.

### Phase 2 — Templates UX + agent node

> **Status (implemented, 2026-10-23).** Verified manually end-to-end: agent node
> created → template composed of built-ins + that node → flow snapshotted and run
> (real agent run produced a markdown artifact; approval-trigger instance held at
> `awaiting_approval` and released via `approve_node`) → YAML export → edit name →
> re-import round-tripped, reusing the identical node_templates row. Deviations:
> contracts generate via zod v4 native `z.toJSONSchema()` (not `zod-to-json-schema`);
> inline agent definitions in YAML resolve via `TemplateStore.ensureNodeTemplate`
> (find-or-create, versioned); built-in component instances must key on the builtin
> catalog key. The Phase-3 (`http`/`script`/`decision`) kinds reject creation and
> import with that exact message — `docs/flow-templates/sentry-triage.yaml` documents
> it as its expected Phase-2 import failure.

- **2A.** Template gallery `/templates` + template editor (step list) + node
  configurator with Trigger/Config/Contract tabs (contract from `zod-to-json-schema`).
- **2B.** `AgentTemplateNode` runtime (§4.2) registered as the handler for
  `kind='agent'` rows; registry extended to resolve declarative kinds from
  `node_templates`.
- **2C.** Generic runtime node panel in `NodePanel.tsx`; graph icons from
  node_templates; template picker on home page.
- **2D.** YAML import/export: `scripts/import-template.mjs` + `POST/GET
  /api/templates/[id]/export`; the two §7 YAML files as fixtures.
- **Acceptance:** from the UI, create an agent node, compose a template of built-ins +
  that node, run a flow on it end-to-end; export → edit → re-import round-trips.

### Phase 3 — decision + http + script nodes

> **Status (implemented, 2026-10-24).** All four bullets landed; verified by hand
> against purpose-built templates (real runs — script nodes executing locally,
> decision branch activation, live HTTP through the guard):
>
> - **3A input mapping** — `lib/engine/flow-context.ts` (`buildFlowContext`) is
>   the single variable universe (`ticket` / `repo` / `flow` / `trigger.payload` /
>   `nodes.<key>.output`; `secrets` deliberately excluded). `runNode` evaluates
>   the template instance's `input_map` JSONata per field and overlays it on the
>   trigger input. Build-time checks: `lintTemplate` (`lib/engine/context-lint.ts`)
>   runs inside `TemplateStore.validated()` on every save/import — `{{refs}}`
>   resolve against upstream contracts, JSONata compiles in input maps / decision
>   expressions / response maps / edge conditions, and decision out-edges must
>   carry labels matching the node's choices.
> - **3B decision** — all three sources run (`expression` inline, `manual` holds
>   for the card, `agent` plan-mode classifier with constrained output and
>   case-insensitive label normalization). `FlowEngine.chooseNode` +
>   `choose_node` action power the manual pick / approval override;
>   approval-triggered decisions pre-select the agent's pick (confirm via
>   `approve_node`). The engine activates exactly the out-edges whose label ∈
>   `output.chosen`; everything else resolves inactive and **skipped propagates**
>   (`resolveInactiveTarget` — all-resolved + none-active ⇒ skipped, recursively
>   downstream). The decision card lives in `components/DeclarativeNodePanel.tsx`;
>   branch labels + taken-edge highlight render in `WorkflowGraph.tsx` (the graph
>   API now serializes `edgeSpecs` with labels/conditions).
> - **3C http + SSRF** — `lib/net/ssrf-guard.ts` pins the IP it checked (custom
>   `lookup`, Host/TLS-SNI keep the original name), re-validates every redirect
>   hop, 5 MB response cap; classification covers loopback / private /
>   link-local / CGNAT / multicast / ULA / reserved + IPv4-mapped IPv6.
>   `secrets` + `http_allowlist` settings keys (merge-semantics PATCH — values
>   write-only) with a Settings → Custom nodes section; `{{secrets.NAME}}`
>   resolves only at execution time and `redactSecrets` scrubs events/errors.
>   Guard checklist verified: allowlist empty/mismatch deny, scheme deny,
>   127.0.0.1 / 192.168 / ::1 / 224.0.0.1 / 100.64 / 169.254.169.254 /
>   localhost-resolves-private / hex-IP `0x7f000001` all blocked; public IP
>   passes policy and fails only at connect.
> - **3D script** — execa with `reject: false` + `SIGKILL` timeout; stdin +
>   `$DEVFLOW_INPUT` carry the mapped input; output resolves from the
>   `$DEVFLOW_OUTPUT` file or the last parseable stdout line; optional
>   `output_schema` validation; env allowlist (PATH/HOME always);
>   `cwd: repo` (repo local path) or `cwd: workspace` (per-flow clone via the
>   new `workspaceForFlow`).
>
> **Fixes made beyond the plan while landing it:**
>
> - jsonata v2's `evaluate()` is Promise-based — `evalJsonata` and every caller
>   (edge conditions, decision expressions, input maps, response maps) are
>   async. (The plan's "sync evaluation" assumption doesn't hold with jsonata ^2.)
> - `buildFlowContext` must parse the raw `nodes.output` TEXT column — raw
>   strings made every `nodes.X.output.Y` expression miss (silent v1-branch
>   selection — caught by the expression test).
> - Declarative outcomes that don't go through an agent run (decision picks,
>   http calls, script runs) now persist through a shared
>   `NodeDefinition.applyOutcome` (artifact + validated output + status +
>   event) — previously the run happened but the node never left `running`.
> - A downstream node's failure no longer propagates up and fails the upstream
>   node whose edge activation started it (`startNodeStage` contains the
>   failure: marks the failing node, stops the advance). Retries of generic
>   nodes now advance the template edges on success (`retryNode`).
> - Template authoring gates lifted everywhere: `createNodeTemplate` /
>   `ensureNodeTemplate` accept all four kinds and validate configs with
>   `parseDeclarativeConfig`; YAML import authors decision/http/script inline;
>   `/api/contracts` serves every declarative kind (incl. decision choices for
>   the configurator); `AddNodeDialog` gained decision/http/script authoring
>   forms; `NodeConfigurator`'s Config tab is schema-driven from each kind's
>   `configFields`.
>
> **Acceptance evidence (manual runs on 2026-10-24):** manual-pick decision →
> `choose_node` approved → non-taken script branch skipped, taken branch ran →
> retry advanced downstream; expression decision (`nodes.probe.output.major >=
> 2`) picked v2, v1 skipped, and `v2_path`'s input carried the input-mapped
> `upstream_major: 2`; http node issued a live guarded request
> (`api.github.com` 200) with a JSONata `response_map`-shaped output;
> loopback-allowlisted `127.0.0.1` call blocked by the IP backstop. SDLC parity
> confirmed: seeded template / snapshot / gate chain derive identically.

- **3A.** Input-mapping engine: flow-context builder, JSONata evaluation at trigger
  time, static validation of references in the configurator (build-time checks, §5).
- **3B.** `decision` node with all three sources (§4.3 — `expression`, `manual`,
  `agent` incl. the decision card + approval-trigger oversight); skipped propagation
  in the engine (1A laid the status); decision-edge activation.
- **3C.** `http` node + `lib/net/ssrf-guard.ts` + `secrets` settings key.
- **3D.** `script` node via execa; stdin/stdout JSON contract; timeout + env allowlist.
- **Acceptance:** the Sentry-triage template (§7) runs end-to-end from a simulated
  webhook payload; SSRF guard verified by hand against a checklist (allowlist,
  redirect re-validation, octal/hex IP forms, multicast).

### Phase 4 — Triggers

> **Status (implemented, 2026-10-24).** All three bullets landed; verified end-to-end via
> real HTTP deliveries against purpose-built templates:
>
> - **4A hooks** — `app/api/hooks/[id]/route.ts` (raw-body read, 1 MB cap,
>   `standardwebhooks` verify, constant-time `x-devflow-secret` fallback, JSONata
>   delivery filter over `{payload, headers}`, `webhook-id` dedup TTL'd in the new
>   `hook_deliveries` table) over the new `lib/engine/hooks.ts` store. Hooks
>   auto-provision: `TemplateStore` create/update/delete syncs one per template with a
>   webhook flow trigger (filter copied, hook removed when the trigger changes); flow
>   creation binds one per `wait_for: webhook` node. The flow trigger JSON now also
>   carries the template's ticket/repo binding (decision 2026-10-24: bind on template —
>   editor pickers appear when webhook/schedule is chosen; `startFromTemplate` errors
>   loudly when unbound). `scripts/send-hook.mjs` signs/sends deliveries (`--raw` =
>   the header fallback). Shipped UI: the template editor's flow-trigger section
>   (hook endpoint + secret + filter + send-hook copy) and a runtime waiting banner
>   in `NodePanel.tsx` (endpoint + secret + copy command).
> - **4B wait_for webhook|timer** — eligible nodes hold at `waiting` (first users of
>   the reserved status). A delivery becomes the run's trigger input AND
>   `{{trigger.payload}}` for the run's context — `runNode` threads it through a
>   fresh `ctxWithDelivery` copy, so `input_map` fields and agent prompt variables
>   read the delivery, not the payload that started the flow (verified; nothing
>   persists from it beyond what the run records). `FlowEngine.resumeNodeFromWebhook`
>   / `processWaitTimers` re-enter `startNodeStage` with `resumeWaiting`; timers arm
>   in-memory (`waitTimers`) and fire from the poller tick. Retrying a `waiting` node
>   is refused; cancel un-sticks it.
> - **4C schedule** — `schedule_next_at` persisted on `flow_templates` (armed on
>   first save, never reset while the trigger stays schedule); the poller tick fires
>   due schedules — one new flow per fire (`{scheduled_at}` as trigger payload), next
>   fire advanced immediately so a failing fire keeps the beat.
>
> **Fixes made beyond the plan while landing it:**
>
> - Webhook/schedule templates auto-start on flow creation (`create()` calls `start()`
>   for those flow-trigger types) — a manually created flow on a webhook template also
>   runs, and `startFromTemplate` doesn't start twice.
>
> **Acceptance evidence (real runs on 2026-10-24):** bad signature → 401 with the
> library reason; fallback with a wrong secret → 401; falsy filter → delivery dropped;
> signed delivery → flow auto-created from the bound template, `probe` script node ran
> to `done`, `fed` (`wait_for: webhook`) held at `waiting` with its own hook bound at
> flow creation → delivering to that hook resumed it with the delivery body as trigger
> input and `input_map` reading the delivery → replay with the same `webhook-id` →
> `{ok: true, dedup: true}`; `wait_for: timer` (1 min) resumed by the poller tick;
> `schedule` (interval 1 min) created + started one flow per fire and advanced its
> next-fire time.

- **4A.** `/api/hooks/[id]` route: raw-body read, `standardwebhooks` verify + secret
  fallback, JSONata filter, dedup by `webhook-id`, flow creation with
  `{{trigger.payload}}`.
- **4B.** Node `wait_for: webhook|timer`: waiting status, hook binding, poller-driven
  timers, resume path into `advance()`.
- **4C.** `schedule` flow trigger via FlowPoller tick.
- **Acceptance:** curl a signed webhook → new flow appears and runs; a
  wait-for-webhook node pauses and resumes on delivery.

### Phase 5 — Visual builder + polish

> **Status (implemented, 2026-10-25).** All of 5A + 5B landed. Verified against the
> running app (real PATCH/import/deletion round-trips; the two demo flows seeded by
> `npm run seed:custom` drive the graph, decision card, and skipped branch):
>
> - **5A visual builder** — the template editor (`app/templates/[id]/page.tsx`) is
>   now a full-bleed **drag-drop canvas** on `@xyflow/react`
>   (`components/template-editor/BuilderCanvas.tsx`): drag to arrange nodes, drag
>   a handle to connect nodes (replaced by the drawer when the pair is already
>   connected by an unlabeled edge), click a node → its **configuration drawer**
>   (`components/ui/sheet.tsx`, side-anchored @base-ui panel) with the display
>   name + the Phase-2 Trigger/Config/Contract tabs; click an edge → the edge
>   drawer (from/to/kind/label/condition, with decision **choice quick-picks**
>   fetched from `/api/contracts`). Layout = persisted x/y wins; dagre fills the
>   gaps. Read-only built-ins show the same canvas minus editing affordances.
>   **Position sync is piecewise**: drags autosave x/y via a new positions-only
>   PATCH branch (`TemplateStore.updatePositions`) that touches no graph rows and
>   deliberately skips `assertNotRunning` — re-layout while a flow runs cannot
>   affect its snapshot. Structural changes remain a wholesale draft PATCH on
>   **Save** (lint/validation/active-flow guard unchanged), now carrying x/y.
>   `GET /api/templates/[id]` and `duplicate()` carry x/y; the edges query got a
>   stable `ORDER BY rowid`.
> - **5B starters + polish** — three new built-in starter templates seeded
>   idempotently next to the SDLC loop (docs generation: agent→script with input
>   mapping; release notes + notify: agent→decision(manual)→http with a `send`
>   branch edge; Sentry triage: webhook trigger + §7 graph), backed by nine
>   declarative catalog rows (`nt_st_*`), each with gallery fixtures in
>   `docs/flow-templates/` (sentry-triage.yaml documented the import since
>   Phase 2; docs-generation.yaml + release-notify.yaml are new). The gallery
>   pins starters above the user's templates and now offers **duplicate** for
>   built-ins too. `npm run seed:custom` (+`:reset`) seeds two complete flows on
>   the release-notify starter (decision chose *send* vs *drop* → notify done vs
>   **skipped**) — a demo that needs no agent runs or credentials. README and
>   this plan updated.
>
> **Fixes made beyond the plan while landing it:**
>
> - **YAML export was broken for multi-line values** — the per-node
>   re-indentation assembly (`"…".join("\n  ")`) destroyed the `yaml` lib's
>   folded double-quoted output (unindented continuation lines → invalid YAML) and
>   blank lines inside block-scalar prompts. `exportTemplateYaml` now stringifies
>   one document object (name/description/trigger/nodes) in a single pass —
>   the lib indents every fold for its true depth — keeping the handcrafted
>   `[from, to, {label}]` edge lines. Caught by the Sentry-starter round-trip
>   (export → import through full validation + lint).
> - Seeded declarative starters must survive import: their configs mirror the
>   fixtures exactly so `lintTemplate` / decision-edge validation passes on both
>   paths.
>
> **Acceptance (run on 2026-10-25):** built a flow entirely in the UI — add node
> from the palette (placed at viewport center), connect by handle drag, edit the
> edge label in the drawer, save, export the YAML file, re-import → identical
> graph; positions-only PATCH round-trips x/y and stays open while a flow runs;
> built-in templates render the canvas read-only; both `seed:custom` flows render
> the template-derived graph with a taken decision branch highlighted and the
> inactive branch skipped.

- **5A.** Drag-drop graph editor on `WorkflowGraph.tsx` (dagre already does layout):
  add node from palette, drag edges, edit labels/conditions inline; syncs `x/y`.
- **5B.** Template duplicate/share (export file), starter gallery (SDLC loop, docs
  generation, release notes + notify, Sentry triage), docs update (README +
  this plan → "implemented" notes), demo seed for a custom flow.
- **Acceptance:** build a flow entirely in the UI without touching YAML; export it;
  a teammate imports it on their machine.

---

## 11. Verification (no automated tests for now)

Automated test suites are deferred by decision. Per-phase verification is manual:

- **Phase 1 parity** is the big one: run both existing seed demos and a manual
  walkthrough of the full loop (plan → refine → build → MR → pipeline fix → review →
  resolve) before/after; behavior must be indistinguishable. Parity checklist in the
  PR.
- **Graph semantics** (join all/any, decision activation, skipped propagation, loop
  caps, debounce) exercised by hand through small purpose-built templates.
- **SSRF guard**: manual checklist — allowlist match, redirect re-validation,
  octal/hex IPv4, IPv6 loopback, multicast.
- **Webhooks**: curl a signed payload (round-trip), stale timestamp, bad signature,
  secret-header fallback, duplicate delivery — `scripts/send-hook.mjs` does all of
  these (`--raw` for the header fallback).
- **Script node**: stdin/stdout contract, timeout kill, non-zero exit — all by hand.

---

## 12. Non-goals & open questions

**Non-goals (for now):** multi-user auth / shared instances; a node marketplace;
embedding an external engine (n8n/Node-RED/Activepieces runtime); sandboxed scripts
(v1 is trusted); structural editing of *running* flows; outbound webhook delivery
infrastructure (the http node covers node-level calls); automated test suites;
per-node/flow cost budgets.

**Resolved during review:** agent-decision UX (§4.3 — auto-built prompt, constrained
output, decision card, approval-trigger oversight); data passing is variables-only
(§5); cost budgets dropped; sub-flows deferred.

**Open questions:**
- Sub-flows (a template as a node inside another template) — revisit after Phase 5.
