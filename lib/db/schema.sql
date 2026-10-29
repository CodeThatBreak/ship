PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,           -- provider issue id
  type          TEXT NOT NULL,              -- task type discriminator (provider kind)
  fields        TEXT NOT NULL DEFAULT '{}', -- provider-specific payload (JSON; jira keeps prd/figma_urls here)
  key           TEXT UNIQUE NOT NULL,       -- e.g. PROJ-123
  summary       TEXT NOT NULL,
  description   TEXT,
  status        TEXT,
  issue_type    TEXT,
  priority      TEXT,
  repo_url      TEXT,                       -- git repo this task maps to
  parent_key    TEXT,                       -- parent issue key (sub-task nesting)
  external_url  TEXT,                       -- external deep link (host app's issue view)
  raw           TEXT,                       -- raw provider payload
  synced_at     TEXT
);

CREATE TABLE IF NOT EXISTS flows (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | done | failed
  mr_url        TEXT,
  mr_iid        INTEGER,
  mr_branch     TEXT,
  repo_url      TEXT,
  gitlab_project_id INTEGER,
  current_node  TEXT,                          -- node key currently running
  worktree_dir  TEXT,                          -- git worktree dir for local runs (created at build start; the hub checkout is never mutated)
  -- step sub-flows (plan fan-out): set on child flows, kind distinguishes them
  parent_flow_id TEXT REFERENCES flows(id),
  kind          TEXT NOT NULL DEFAULT 'sdlc',  -- sdlc | step
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  node_key      TEXT NOT NULL,              -- plan | build | pipeline | review | resolve
  type          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|awaiting_approval|approved|failed|done|waiting|skipped
  agent_id      TEXT,                        -- runtime agent handle captured from the last run
  agent_ref     TEXT,
  input         TEXT,                        -- JSON
  output        TEXT,                        -- JSON
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(flow_id, node_key)
);

-- versioned artifacts produced by nodes (plan v1..vN, code diffs, review rounds)
CREATE TABLE IF NOT EXISTS artifacts (
  id            TEXT PRIMARY KEY,
  node_id       TEXT NOT NULL REFERENCES nodes(id),
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  kind          TEXT NOT NULL,             -- plan | diff | review | fix | resolve
  version       INTEGER NOT NULL,          -- 1-based per (node_id, kind)
  content       TEXT NOT NULL,             -- markdown / diff / json
  meta          TEXT,                      -- JSON (run ref, branch, etc.)
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | approved | superseded
  feedback      TEXT,                      -- human feedback that produced next version
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(node_id, kind, version);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,          -- git-host note id (host-prefixed, globally unique)
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  mr_iid        INTEGER,
  discussion_id TEXT,
  author        TEXT,
  body          TEXT,
  file_path     TEXT,
  line          INTEGER,
  status        TEXT NOT NULL DEFAULT 'open',  -- open | resolving | resolved | wontfix
  resolved_by   TEXT,
  raw           TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(discussion_id, id)
);
CREATE INDEX IF NOT EXISTS idx_comments_flow ON comments(flow_id, status);

-- chat thread between the developer and the node agents
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  node_key      TEXT,                        -- which node the message targets
  thread        TEXT,                        -- the per-refinement thread (branch name); NULL = the main conversation
  role          TEXT NOT NULL,               -- user | assistant
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_flow ON messages(flow_id, created_at);

-- append-only event log (drives the live activity feed + polling)
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  node_id       TEXT,
  type          TEXT NOT NULL,             -- status|log|assistant|tool|error|lifecycle
  message       TEXT,
  data          TEXT,                      -- JSON
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_flow ON events(flow_id, created_at);

-- structured plan steps: the live, editable checklist extracted from the plan's
-- plan-meta block (plus steps added by hand). status is toggled manually and
-- updated from the build agent's build-progress report.
CREATE TABLE IF NOT EXISTS plan_steps (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  artifact_id   TEXT REFERENCES artifacts(id), -- plan version the step came from (NULL for manual steps)
  meta_id       TEXT,                          -- stable id within a version (agent steps only) for refine-merge
  position      INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  detail        TEXT,
  files         TEXT,                          -- JSON array of file paths
  branch        TEXT,                          -- owning branch name for multi-branch plans
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | done
  origin        TEXT NOT NULL DEFAULT 'agent',   -- agent | user
  completed_by  TEXT,                            -- manual | build | NULL
  sub_flow_id   TEXT REFERENCES flows(id),       -- step ⇄ sub-flow linkage (plan fan-out)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_steps_flow ON plan_steps(flow_id, position);

-- durable cursor-run handles so we can resume / re-attach after restart
-- Phase 3C: per-branch tracking for multi-branch builds
CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  name          TEXT NOT NULL,             -- git branch name
  title         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|building|awaiting_approval|approved|failed|done
  mr_url        TEXT,
  mr_iid        INTEGER,
  "order"       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(flow_id, name)
);
CREATE INDEX IF NOT EXISTS idx_branches_flow ON branches(flow_id, status);
CREATE INDEX IF NOT EXISTS idx_branches_mr ON branches(mr_iid) WHERE mr_iid IS NOT NULL;

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,          -- our id
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  node_id       TEXT NOT NULL REFERENCES nodes(id),
  agent_ref     TEXT NOT NULL,             -- runtime agent handle (cloud agent id / local session id)
  run_ref       TEXT NOT NULL,             -- the runtime's run id
  branch_id     TEXT REFERENCES branches(id),  -- Phase 3C: per-branch attribution
  status        TEXT NOT NULL DEFAULT 'running',  -- running|finished|error|cancelled
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- repo registry: local path ↔ cloud URL (per-domain GitLab) for each repo
CREATE TABLE IF NOT EXISTS repos (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  cloud_url     TEXT UNIQUE NOT NULL,      -- e.g. https://gitlab.company.com/group/repo
  local_path    TEXT,                      -- local checkout used for local agent runs + diffs
  default_branch TEXT NOT NULL DEFAULT 'main',
  -- worktree setup policy (Phase 2): per-repo overrides for the pure dep-policy
  -- table (lib/git/dep-policy.ts). Odd repos are configured, never special-cased.
  install_command TEXT,                    -- wins over the auto-detected policy (run in worktree root)
  skip_install  INTEGER NOT NULL DEFAULT 0, -- no dependency setup at all (vendored deps, terraform, …)
  sync_paths    TEXT,                       -- glob list override for untracked config synced hub→worktree
  shared_dirs   TEXT,                       -- dirs symlinked hub→worktree before setup (shared caches)
  setup_command TEXT,                       -- extra escape valve, always runs after the dep strategy
  worktree_timeout_ms INTEGER,              -- `git worktree add` timeout override (NULL = the 120s default; large checkouts need more)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- self-hosted GitLab instances: repo host → API token
CREATE TABLE IF NOT EXISTS gitlab_instances (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  base_url      TEXT UNIQUE NOT NULL,      -- e.g. https://gitlab.company.com
  token         TEXT NOT NULL,             -- PAT with api scope
  created_at    TEXT NOT NULL
);

-- Jira instances (cloud sites + self-hosted): managed from Settings → Integrations → Task
CREATE TABLE IF NOT EXISTS jira_instances (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  base_url      TEXT UNIQUE NOT NULL,      -- e.g. https://you.atlassian.net
  email         TEXT NOT NULL,             -- login email / username (Basic auth)
  token         TEXT NOT NULL,             -- API token (cloud) or PAT (self-hosted)
  created_at    TEXT NOT NULL
);

-- app-level settings (execution defaults, local agent options)
CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

-- ── custom flows & custom nodes (Phase 1: template layer) ────────────────────

-- Node type catalog: built-ins (seeded rows) + user-defined declarative nodes.
-- Built-in rows carry knob overrides only; declarative kinds carry their full
-- definition (`config` = prompt/output schema for agent, url/method/config for
-- http, runtime/script for script, source/choices for decision).
CREATE TABLE IF NOT EXISTS node_templates (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,              -- built-ins: the five node keys
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- builtin | agent | http | script | decision
  version      INTEGER NOT NULL DEFAULT 1,
  description  TEXT,
  icon         TEXT,                       -- lucide icon name for the graph
  config       TEXT NOT NULL DEFAULT '{}', -- declarative kinds: definition; builtin: knob overrides
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  -- NULL = global Library row shared across templates; set = private to that template
  template_id  TEXT REFERENCES flow_templates(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(key, version)
);

-- Flow templates: named flows (graph + per-node config). Flows instantiate from
-- a template and snapshot their node set — running flows are never mutated by
-- template edits.
CREATE TABLE IF NOT EXISTS flow_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  trigger      TEXT NOT NULL DEFAULT '{"type":"manual"}',  -- flow trigger JSON
  -- next fire time for a `schedule` flow trigger (Phase 4C); NULL = not scheduled.
  -- Persisted so the schedule survives restarts.
  schedule_next_at TEXT,
  -- auto-wrapped child templates (plan fan-out; excluded from the gallery)
  hidden       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Node instances within a template (wiring layer: trigger / join / config knob
-- overrides / input mapping — never internals). `type` is the node_templates
-- key for built-ins; `trigger` JSON is {type: auto|manual|approval|debounced,
-- minutes?, wait_for?}.
CREATE TABLE IF NOT EXISTS flow_template_nodes (
  id               TEXT PRIMARY KEY,
  template_id      TEXT NOT NULL REFERENCES flow_templates(id),
  node_key         TEXT NOT NULL,          -- instance key, unique per template
  node_template_id TEXT NOT NULL REFERENCES node_templates(id),
  label            TEXT,                   -- display name override
  trigger          TEXT NOT NULL DEFAULT '{"type":"auto"}',
  join_mode        TEXT NOT NULL DEFAULT 'all',   -- all | any
  config           TEXT NOT NULL DEFAULT '{}',    -- knob overrides
  input_map        TEXT NOT NULL DEFAULT '{}',    -- {field: JSONata expr} (Phase 3)
  x                REAL,
  y                REAL,                          -- graph editor positions (Phase 5)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(template_id, node_key)
);

-- Edges within a template. `kind: loop` edges are display metadata for the
-- built-in runtime loops (Phase 1) — re-trigger edges become executable when
-- decision/condition evaluation lands (Phase 3: conditions, skipped).
CREATE TABLE IF NOT EXISTS flow_template_edges (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES flow_templates(id),
  from_key     TEXT NOT NULL,
  to_key       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'next',  -- next | loop
  label        TEXT,                          -- decision edge label (Phase 3)
  condition    TEXT,                          -- optional JSONata expr (Phase 3)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(template_id, from_key, to_key, label)
);

-- Generic inbound webhook endpoints (Phase 4 — table reserved now so flows can
-- reference it the moment the trigger layer lands).
CREATE TABLE IF NOT EXISTS hooks (
  id           TEXT PRIMARY KEY,            -- /api/hooks/<id>
  template_id  TEXT REFERENCES flow_templates(id),  -- set ⇒ starts a new flow
  flow_id      TEXT REFERENCES flows(id),           -- set ⇒ feeds a waiting node
  node_key     TEXT,
  secret       TEXT NOT NULL,
  filter       TEXT,                        -- optional JSONata boolean filter
  created_at   TEXT NOT NULL
);

-- Delivery dedup: seen webhook-ids per hook (Phase 4A), TTL'd by the store.
CREATE TABLE IF NOT EXISTS hook_deliveries (
  hook_id      TEXT NOT NULL REFERENCES hooks(id),
  webhook_id   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(hook_id, webhook_id)
);

-- Crash-safe worktree removal records: persisted BEFORE the git removal runs
-- (git drops a worktree's registration even when the directory delete fails —
-- without a record the leftover is lost forever). Rows are deleted on success;
-- rows surviving a crash are resumed by the startup sweep.
CREATE TABLE IF NOT EXISTS worktree_removals (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT,                        -- owning flow (dangling when the flow is deleted first)
  repo_path     TEXT,                        -- hub path at record time (may be gone later)
  path          TEXT NOT NULL,               -- worktree dir to remove
  branch        TEXT,                        -- branch to consider for merged-only cleanup
  delete_branch INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  created_at    TEXT NOT NULL
);

-- Durable fan-out merge-back record (plan fan-out, Phase 1) so restarts and
-- the reconcile sweep can resume or flag stuck merges. Code children (node def
-- with a `mergeBack` hook) get one row per merge attempt; NULL `branch` ⇒
-- non-code children create no rows (their output is aggregated, never merged).
CREATE TABLE IF NOT EXISTS step_merges (
  id             TEXT PRIMARY KEY,
  flow_id        TEXT NOT NULL REFERENCES flows(id),   -- child flow
  parent_flow_id TEXT NOT NULL REFERENCES flows(id),
  parent_node    TEXT NOT NULL,              -- the fan-out node key (e.g. 'build')
  branch         TEXT,                       -- step branch (code children only)
  status         TEXT NOT NULL DEFAULT 'running',  -- running | conflict | rejected | merged | failed
--                                                    (conflict/rejected = repairable, the bounded
--                                                     merge-fix agent owns it; failed = infra/exhausted)
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_merges_parent ON step_merges(parent_flow_id, parent_node, status);
