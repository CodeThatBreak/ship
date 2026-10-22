PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,           -- jira issue id
  key           TEXT UNIQUE NOT NULL,       -- e.g. PROJ-123
  summary       TEXT NOT NULL,
  description   TEXT,
  status        TEXT,
  issue_type    TEXT,
  priority      TEXT,
  prd_text      TEXT,                       -- extracted PRD body
  figma_urls    TEXT,                       -- JSON array of figma links
  repo_url      TEXT,                       -- gitlab repo this ticket maps to
  jira_url      TEXT,
  raw           TEXT,                       -- raw jira payload
  synced_at     TEXT
);

CREATE TABLE IF NOT EXISTS flows (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | done | failed
  mr_url        TEXT,
  mr_iid        INTEGER,
  mr_branch     TEXT,
  repo_url      TEXT,
  gitlab_project_id INTEGER,
  current_node  TEXT,                          -- node key currently running
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id),
  node_key      TEXT NOT NULL,              -- plan | build | pipeline | review | resolve
  type          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|awaiting_approval|approved|failed|done
  agent_id      TEXT,                        -- cursor agent id
  cursor_agent_id TEXT,
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
  meta          TEXT,                      -- JSON (cursor run id, branch, etc.)
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | approved | superseded
  feedback      TEXT,                      -- human feedback that produced next version
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(node_id, kind, version);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,          -- gitlab note id (prefixed)
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
  cursor_agent_id TEXT NOT NULL,
  cursor_run_id TEXT NOT NULL,
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

-- app-level settings (execution defaults, local agent options)
CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
