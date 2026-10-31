import "server-only";

import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { config } from "../config";
import { processSingleton } from "../singleton";
import { NotFoundError } from "../errors";
import { DatabaseMigrationError } from "./database-migration-error";
import { getRowGateway } from "./row-gateway-access";
import { EventRow, MessageRow, RepoRow, type Repo } from "./rows";
import { SCHEMA_USER_VERSION } from "./schema-version";
import { SDLC_TEMPLATE_ID } from "../engine/templates/template-store";
import { NODE_KEYS, STEP_BUILD_TEMPLATE_ID } from "../engine/constants/node-keys";

export type { Repo } from "./rows";

/**
 * The application database (better-sqlite3, WAL mode).
 *
 * Owns the connection lifecycle, canonical schema bootstrap and versioned
 * migrations, plus the low-level query helpers (get/all/run) and the small domain stores
 * (messages, events, settings, repos) that don't warrant their own class yet.
 */
export class Database {
  private conn: SqliteDatabase.Database | null = null;
  /** Same-millisecond counter so event ids sort lexicographically in emit order. */
  private uidLastMs = 0;
  private uidSeqInMs = 0;

  /** Run synchronous writes in one SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.connection().transaction(fn)();
  }

  /** Lazily open (and migrate) the connection. */
  connection(): SqliteDatabase.Database {
    if (this.conn) return this.conn;
    const file = config.db.path();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let pending: SqliteDatabase.Database | null = null;
    try {
      pending = new SqliteDatabase(file);
      pending.pragma("journal_mode = WAL");
      this.bootstrap(pending);
      this.conn = pending;
      pending = null;
      return this.conn;
    } catch (err) {
      pending?.close();
      if (err instanceof DatabaseMigrationError) throw err;
      const cause = err instanceof Error ? err : undefined;
      throw new DatabaseMigrationError("Database bootstrap failed", { cause });
    }
  }

  private bootstrap(d: SqliteDatabase.Database): void {
    const schemaPath = config.db.schemaSqlPath();
    let schema: string;
    try {
      schema = fs.readFileSync(schemaPath, "utf8");
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw new DatabaseMigrationError(`Failed to read schema at ${schemaPath}`, { cause });
    }
    d.exec(schema);
    this.runMigrations(d);
  }

  /** Numbered migrations gated on `PRAGMA user_version` (each step is one transaction). */
  private runMigrations(d: SqliteDatabase.Database): void {
    let version = d.pragma("user_version", { simple: true }) as number;
    while (version < SCHEMA_USER_VERSION) {
      const next = version + 1;
      try {
        d.transaction(() => {
          if (next === 1) {
            this.seedTemplates(d);
          } else if (next === 2) {
            const cols = d.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "attempt_id")) {
              d.exec(`ALTER TABLE nodes ADD COLUMN attempt_id TEXT`);
            }
          } else if (next === 3) {
            const cols = d.prepare(`PRAGMA table_info(branches)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "git_branch")) {
              d.exec(`ALTER TABLE branches ADD COLUMN git_branch TEXT`);
            }
          } else if (next === 4) {
            const cols = d.prepare(`PRAGMA table_info(flows)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "template_graph")) {
              d.exec(`ALTER TABLE flows ADD COLUMN template_graph TEXT`);
            }
          } else if (next === 5) {
            d.exec(`
              CREATE INDEX IF NOT EXISTS idx_runs_node ON runs(node_id);
              CREATE INDEX IF NOT EXISTS idx_runs_flow ON runs(flow_id);
              CREATE INDEX IF NOT EXISTS idx_runs_run_ref ON runs(run_ref);
              CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
              CREATE INDEX IF NOT EXISTS idx_flows_parent ON flows(parent_flow_id) WHERE parent_flow_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_gitlab_project ON flows(gitlab_project_id) WHERE gitlab_project_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);
              CREATE INDEX IF NOT EXISTS idx_flows_template ON flows(template_id) WHERE template_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_repo ON flows(repo_id) WHERE repo_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_plan_steps_sub_flow ON plan_steps(sub_flow_id) WHERE sub_flow_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_step_merges_flow ON step_merges(flow_id);
              CREATE INDEX IF NOT EXISTS idx_hook_deliveries_created ON hook_deliveries(created_at);
            `);
          } else {
            throw new Error(`No migration defined for user_version ${next}`);
          }
          d.pragma(`user_version = ${next}`);
        })();
      } catch (err) {
        const cause = err instanceof Error ? err : undefined;
        throw new DatabaseMigrationError(`Migration to user_version ${next} failed`, { cause });
      }
      version = next;
    }
  }

  /**
   * Seed the built-in node templates and the SDLC flow template (§7 of the
   * custom-flows plan). Idempotent: deterministic ids + INSERT OR IGNORE.
   */
  private seedTemplates(d: SqliteDatabase.Database): void {
    const now = new Date().toISOString();
    const nt: [string, string, string, string, string][] = [
      // id, key, name, description, icon
      ["nt_start", "start", "Start", "The template's entry node — carries the branch trigger, then finishes immediately", "Play"],
      ["nt_plan", "plan", "Plan", "Plan the implementation on a planning agent", "Compass"],
      ["nt_build", "build", "Build", "Implement the approved plan on an agent", "Hammer"],
      ["nt_step_build", "step_build", "Step build", "One plan step built by its own child flow (plan fan-out) — per-step branch, diff and approval", "Hammer"],
      ["nt_pipeline", "pipeline", "Pipeline", "Wait for a green CI pipeline, fixing failures", "Gauge"],
      ["nt_review", "review", "Review", "AI review of the MR diff", "ScanSearch"],
      ["nt_resolve", "resolve", "Resolve", "Address open MR comments", "CheckCheck"],
    ];
    const ntStmt = d.prepare(
      `INSERT OR IGNORE INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
       VALUES (?,?,?,'builtin',1,?,?,'{}',1,?,?)`
    );
    for (const [id, key, name, description, icon] of nt) {
      ntStmt.run(id, key, name, description, icon, now, now);
    }
    const hasSdlc = d.prepare(`SELECT 1 FROM flow_templates WHERE id=?`).get(SDLC_TEMPLATE_ID);
    if (!hasSdlc) {
      d.prepare(
        `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        SDLC_TEMPLATE_ID,
        "SDLC loop",
        "The built-in software development loop: plan → build → pipeline → review → resolve.",
        1,
        1,
        '{"type":"manual"}',
        now,
        now,
      );
      // (key, trigger JSON) — minutes mirrors the resolve quiet-period default
      const nodes: [string, string][] = [
        [NODE_KEYS.PLAN, '{"type":"manual"}'],
        [NODE_KEYS.BUILD, '{"type":"approval"}'],
        [NODE_KEYS.PIPELINE, '{"type":"auto","wait_for":"pipeline"}'],
        [NODE_KEYS.REVIEW, '{"type":"auto"}'],
        [NODE_KEYS.RESOLVE, '{"type":"debounced","minutes":10,"wait_for":"comments"}'],
      ];
      for (const [key, trigger] of nodes) {
        const id = `ftn_${key}`;
        const nodeTemplateId = `nt_${key}`;
        d.prepare(
          `INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
           VALUES (?,?,?,?,NULL,?,'all','{}','{}',?,?)`
        ).run(id, SDLC_TEMPLATE_ID, key, nodeTemplateId, trigger, now, now);
      }
      const eStmt = d.prepare(
        `INSERT OR IGNORE INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      // (from, to, kind, condition) — the loop is template data now: resolve
      // re-enters the CI gate only when the resolve agent actually pushed code
      // (JSONata over the resolve output contract); a no-code fix ends the
      // cycle. Condition-less loop edges stay display metadata.
      const edges: [string, string, string, string | null][] = [
        [NODE_KEYS.PLAN, NODE_KEYS.BUILD, "next", null],
        [NODE_KEYS.BUILD, NODE_KEYS.PIPELINE, "next", null],
        [NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, "next", null],
        [NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE, "next", null],
        [NODE_KEYS.RESOLVE, NODE_KEYS.PIPELINE, "loop", "nodes.resolve.output.codeChanged = true"],
      ];
      edges.forEach(([from, to, kind, condition]) => {
        eStmt.run(`fte_${from}_${to}`, SDLC_TEMPLATE_ID, from, to, kind, null, condition, now, now);
      });
    } else {
      // migrate older seedings: the display-only `resolve → review` loop edge
      // becomes the real re-entry `resolve → pipeline` edge (conditioned on
      // the resolve output contract). Idempotent: deterministic edge ids, and
      // existing running flows keep their snapshotted graph semantics.
      d.prepare(
        `DELETE FROM flow_template_edges
         WHERE template_id=? AND id='fte_resolve_review'
           AND from_key=? AND kind='loop'`
      ).run(SDLC_TEMPLATE_ID, NODE_KEYS.RESOLVE);
      d.prepare(
        `INSERT OR IGNORE INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
         VALUES ('fte_resolve_pipeline',?,?,?,?,?,NULL,?,?)`
      ).run(
        SDLC_TEMPLATE_ID,
        NODE_KEYS.RESOLVE,
        NODE_KEYS.PIPELINE,
        "loop",
        "nodes.resolve.output.codeChanged = true",
        now,
        now,
      );
    }

    // ── Plan fan-out: the built-in step template (Phase 1A) ─────────────────
    // The child template a fan-out `build` node defaults to (`child` unset):
    // one node instance of the step_build builtin def with an approval trigger
    // — the per-step gate. The StepFlowManager snapshots it per child flow and
    // feeds the {plan, step, siblings} trigger payload. `hidden` keeps it out
    // of the gallery (it is a child template; the fan-out knob references it
    // by id, never the picker).
    if (!d.prepare(`SELECT 1 FROM flow_templates WHERE id=?`).get(STEP_BUILD_TEMPLATE_ID)) {
      d.prepare(
        `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,hidden,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        STEP_BUILD_TEMPLATE_ID,
        "Step build",
        "One plan step built by its own child flow — per-step branch, diff and approval gate (fan-out child of the build node).",
        1,
        1,
        '{"type":"manual"}',
        1,
        now,
        now,
      );
      d.prepare(
        `INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
         VALUES (?,?,?,?,NULL,'{"type":"approval"}','all','{}','{}',?,?)`
      ).run(
        "ftn_tpl_step_build_step_build",
        STEP_BUILD_TEMPLATE_ID,
        NODE_KEYS.STEP_BUILD,
        "nt_step_build",
        now,
        now,
      );
    }

    // ── Phase 5: starter templates ──────────────────────────────────────────
    // Declarative catalog rows the starters reference (is_builtin=0 — the user
    // may edit/duplicate them like any authored node), then three built-in
    // flow templates exercosing agent / decision / http / script + input maps.
    // Idempotent: deterministic ids + INSERT OR IGNORE; configs mirror the
    // docs/flow-templates/*.yaml fixtures so export/import round-trips.
    const starterNodes: [string, string, string, string, string, string, string][] = [
      // id, key, kind, name, icon, description, config JSON
      ["nt_st_summarize", "docs_summary", "agent", "Docs summarize", "agent",
        "Plan-mode agent that summarizes shipped work into markdown",
        JSON.stringify({
          mode: "plan", output: "markdown",
          prompt: "Summarize the shipped work on task {{task.key}} — {{task.summary}}.\n"
            + "Read the repo at {{repo.local_path}} and cover: user-facing changes,\n"
            + "configuration surface, and gotchas. Write it as markdown.",
        })],
      ["nt_st_write_doc", "docs_write", "script", "Docs write", "Terminal",
        "Shell script that saves the mapped `doc` field into the repo's docs/",
        JSON.stringify({
          runtime: "shell",
          script: "cat > docs/devflow-summary.md\necho '{\"written\": true}'",
          cwd: "repo",
        })],
      ["nt_st_release_notes", "release_notes", "agent", "Release notes draft", "agent",
        "Plan-mode agent that drafts release notes from the task",
        JSON.stringify({
          mode: "plan", output: "markdown",
          prompt: "Draft release notes for task {{task.key}} ({{task.summary}}).\n"
            + "Lead with user impact, then notable behavior changes and migrations. Under 200 words.",
        })],
      ["nt_st_ship_decision", "ship_decision", "decision", "Ship decision", "Split",
        "Manual choice: send the draft out or drop it",
        JSON.stringify({
          source: "manual",
          choices: [
            { label: "send", description: "Good enough — notify the webhook" },
            { label: "drop", description: "Not ready — skip the notify" },
          ],
        })],
      ["nt_st_notify", "notify_slack", "http", "Notify webhook", "Send",
        "Outbound HTTP notification ({{secrets.SLACK_WEBHOOK}} resolves at run time)",
        JSON.stringify({
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "Release notes:\n\n{{nodes.release_notes.output.markdown}}",
        })],
      ["nt_st_triage", "triage_agent", "agent", "Sentry triage", "agent",
        "Plan-mode agent that triages a Sentry issue into structured JSON",
        JSON.stringify({
          mode: "plan", output: "json",
          prompt: "Triage this Sentry issue: {{trigger.payload.issue.title}}\n\nStacktrace:\n{{trigger.payload.issue.stacktrace}}\n"
            + "Task context: {{task.key}} — {{task.summary}}\n\n"
            + "Scan the codebase for the likely cause, then output JSON: {severity, summary, suggested_fix}.",
          output_schema: {
            type: "object",
            required: ["severity", "summary"],
            properties: {
              severity: { type: "string", enum: ["low", "med", "high"] },
              summary: { type: "string" },
              suggested_fix: { type: "string" },
            },
          },
        })],
      ["nt_st_worth_fixing", "worth_fixing", "decision", "Worth fixing?", "Split",
        "Agent proposes; with trigger: approval the user disposes (§4.3)",
        JSON.stringify({
          source: "agent",
          question: "Given the triage result, is this issue worth an automated fix PR?",
          choices: [
            { label: "fix", description: "Real user-facing bug with a plausible localized fix" },
            { label: "ignore", description: "Noise, duplicate, or too risky to auto-fix" },
          ],
        })],
      ["nt_st_open_pr", "open_pr", "agent", "Open fix PR", "Bot",
        "Agent-mode run with repo access that fixes the triaged issue",
        JSON.stringify({
          mode: "agent",
          prompt: "Fix the issue: {{nodes.triage.output.suggested_fix}} — issue {{task.key}}.",
        })],
      ["nt_st_triage_notify", "triage_notify", "http", "Notify webhook", "Send",
        "Outbound notification with the triage summary (secrets resolve at run time)",
        JSON.stringify({
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "{ \"text\": \"Triaged {{task.key}}: {{nodes.triage.output.summary}}\" }",
        })],
    ];
    const starterNodeStmt = d.prepare(
      `INSERT OR IGNORE INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
       VALUES (?,?,?,?,1,?,?,?,0,?,?)`
    );
    for (const [id, key, kind, name, icon, description, config] of starterNodes) {
      starterNodeStmt.run(id, key, name, kind, description, icon, config, now, now);
    }

    const starterTemplates: {
      id: string; name: string; description: string; trigger: string;
      nodes: [string, string, string, string | null, string | null][]; // key, nodeTemplateId, trigger, config, inputMap
      edges: [string, string, string, string | null][]; // from, to, kind, label
    }[] = [
      {
        id: "tpl_docs_generation",
        name: "Docs generation",
        description: "Summarize shipped work on a task into a docs page in the repo — starter: agent → script with input mapping.",
        trigger: '{"type":"manual"}',
        nodes: [
          ["summarize", "nt_st_summarize", '{"type":"auto"}', null, null],
          ["write_doc", "nt_st_write_doc", '{"type":"auto"}', null, '{"doc":"nodes.summarize.output.markdown"}'],
        ],
        edges: [["summarize", "write_doc", "next", null]],
      },
      {
        id: "tpl_release_notify",
        name: "Release notes + notify",
        description: "Draft release notes from a task, decide whether to ship them, and notify a webhook — starter: agent → decision (manual) → http.",
        trigger: '{"type":"manual"}',
        nodes: [
          ["release_notes", "nt_st_release_notes", '{"type":"auto"}', null, null],
          ["ship_decision", "nt_st_ship_decision", '{"type":"auto"}', null, null],
          ["notify", "nt_st_notify", '{"type":"auto"}', null, null],
        ],
        edges: [
          ["release_notes", "ship_decision", "next", null],
          ["ship_decision", "notify", "next", "send"],
        ],
      },
      {
        id: "tpl_sentry_triage",
        name: "Sentry triage",
        description: "Inbound-webhook triage: agent triages a Sentry issue, an agent-proposes / approval-disposes decision branches fix/ignore, Slack gets notified. Duplicate to bind a task type + repo.",
        trigger: '{"type":"webhook","filter":"payload.event = \'issue.created\'"}',
        nodes: [
          ["triage", "nt_st_triage", '{"type":"auto"}', null,
            '{"summary":"trigger.payload.issue.title","stack":"trigger.payload.issue.stacktrace"}'],
          ["worth_fixing", "nt_st_worth_fixing", '{"type":"approval"}', null, null],
          ["open_pr", "nt_st_open_pr", '{"type":"auto"}', null, null],
          ["notify", "nt_st_triage_notify", '{"type":"auto"}', null, null],
        ],
        edges: [
          ["triage", "worth_fixing", "next", null],
          ["worth_fixing", "open_pr", "next", "fix"],
          ["triage", "notify", "next", null],
        ],
      },
    ];
    for (const st of starterTemplates) {
      const exists = d.prepare(`SELECT 1 FROM flow_templates WHERE id=?`).get(st.id);
      if (exists) continue;
      d.prepare(
        `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
         VALUES (?,?,?,1,1,?,?,?)`
      ).run(st.id, st.name, st.description, st.trigger, now, now);
      for (const [key, nodeTemplateId, trigger, config, inputMap] of st.nodes) {
        d.prepare(
          `INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,x,y,created_at,updated_at)
           VALUES (?,?,?,?,NULL,?,'all',?,?,NULL,NULL,?,?)`
        ).run(`ftn_${st.id.slice(4)}_${key}`, st.id, key, nodeTemplateId, trigger, config ?? "{}", inputMap ?? "{}", now, now);
      }
      for (const [from, to, kind, label] of st.edges) {
        d.prepare(
          `INSERT OR IGNORE INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
           VALUES (?,?,?,?,?,?,NULL,?,?)`
        ).run(`fte_${st.id.slice(4)}_${from}_${to}${label ? `_${label}` : ""}`, st.id, from, to, kind, label, now, now);
      }
    }
  }

  // ── ids & timestamps ──────────────────────────────
  now(): string {
    return new Date().toISOString();
  }

  uid(prefix = ""): string {
    const ms = Date.now();
    if (ms !== this.uidLastMs) {
      this.uidLastMs = ms;
      this.uidSeqInMs = 0;
    }
    const seq = this.uidSeqInMs++;
    const seqPart = seq.toString(36).padStart(4, "0");
    const entropy = Math.random().toString(36).slice(2, 6);
    return `${prefix}${ms.toString(36)}${seqPart}${entropy}`;
  }

  // ── typed row helpers ────────────────────────────────────────────────────
  get<T = unknown>(sql: string, ...args: unknown[]): T | undefined {
    return this.connection().prepare(sql).get(...args) as T | undefined;
  }

  all<T = unknown>(sql: string, ...args: unknown[]): T[] {
    return this.connection().prepare(sql).all(...args) as T[];
  }

  run(sql: string, ...args: unknown[]) {
    return this.connection().prepare(sql).run(...args);
  }

  // ── messages ─────────────────────────────────────────────────────────────
  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null
  ): void {
    this.run(
      `INSERT INTO messages (id, flow_id, node_key, thread, role, content, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      this.uid("msg_"), flowId, nodeKey, thread ?? null, role, content, this.now()
    );
  }

  listMessages(flowId: string) {
    return getRowGateway().all(
      MessageRow,
      `SELECT * FROM messages WHERE flow_id=? ORDER BY created_at, id`,
      flowId,
    );
  }

  // ── events ───────────────────────────────────────────────────────────────
  listEvents(flowId: string, after: string, limit: number) {
    return getRowGateway().all(
      EventRow,
      `SELECT * FROM events WHERE flow_id=? AND id > ? ORDER BY created_at, id LIMIT ?`,
      flowId,
      after,
      limit,
    );
  }

  /** Newest `limit` events for a flow, returned oldest-first for the feed. */
  listEventsTail(flowId: string, limit: number) {
    const rows = getRowGateway().all(
      EventRow,
      `SELECT * FROM events WHERE flow_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
      flowId,
      limit,
    );
    return rows.reverse();
  }

  emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>
  ): void {
    this.run(
      `INSERT INTO events (id, flow_id, node_id, type, message, data, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      this.uid("ev_"),
      flowId,
      nodeId,
      type,
      message,
      data ? JSON.stringify(data) : null,
      this.now()
    );
  }

  // ── settings (key/value, JSON-encoded values) ────────────────────────────
  getSetting<S extends z.ZodTypeAny>(key: string, schema: S, fallback: z.infer<S>): z.infer<S> {
    const row = this.get<{ value: string }>(`SELECT value FROM settings WHERE key=?`, key);
    if (!row) return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return fallback;
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.run(
      `INSERT INTO settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      key,
      JSON.stringify(value)
    );
  }

  // ── repo registry ────────────────────────────────────────────────────────
  listRepos(): Repo[] {
    return getRowGateway().all(RepoRow, `SELECT * FROM repos ORDER BY name`);
  }

  repoById(id: string): Repo | undefined {
    return getRowGateway().get(RepoRow, `SELECT * FROM repos WHERE id=?`, id);
  }

  /** Find a registered repo by its cloud URL (normalizes trailing slashes/.git). */
  repoByCloudUrl(cloudUrl: string): Repo | undefined {
    const norm = this.normalizeRepoUrl(cloudUrl);
    return this.listRepos().find((r) => this.normalizeRepoUrl(r.cloud_url) === norm);
  }

  normalizeRepoUrl(url: string): string {
    return url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  }

  upsertRepo(input: {
    id?: string;
    name: string;
    cloud_url: string;
    local_path?: string | null;
    default_branch?: string;
    // worktree setup policy overrides (Phase 2)
    install_command?: string | null;
    skip_install?: boolean;
    sync_paths?: string | null;
    shared_dirs?: string | null;
    setup_command?: string | null;
    worktree_timeout_ms?: number | null;
  }): Repo {
    const ts = this.now();
    const cloudUrl = this.normalizeRepoUrl(input.cloud_url);
    if (input.id) {
      const changes = this.run(
        `UPDATE repos SET name=?, cloud_url=?, local_path=?, default_branch=?,
         install_command=?, skip_install=?, sync_paths=?, shared_dirs=?, setup_command=?, worktree_timeout_ms=?, updated_at=? WHERE id=?`,
        input.name, cloudUrl, input.local_path ?? null, input.default_branch ?? "main",
        input.install_command ?? null, input.skip_install ? 1 : 0,
        input.sync_paths ?? null, input.shared_dirs ?? null, input.setup_command ?? null,
        input.worktree_timeout_ms ?? null,
        ts, input.id
      ).changes;
      if (changes === 0) throw new NotFoundError("repo", input.id);
      const repo = this.repoById(input.id);
      if (!repo) throw new NotFoundError("repo", input.id);
      return repo;
    }
    const id = this.uid("repo_");
    this.run(
      `INSERT INTO repos (id,name,cloud_url,local_path,default_branch,install_command,skip_install,sync_paths,shared_dirs,setup_command,worktree_timeout_ms,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.name, cloudUrl, input.local_path ?? null, input.default_branch ?? "main",
      input.install_command ?? null, input.skip_install ? 1 : 0,
      input.sync_paths ?? null, input.shared_dirs ?? null, input.setup_command ?? null,
      input.worktree_timeout_ms ?? null,
      ts, ts
    );
    const repo = this.repoById(id);
    if (!repo) throw new NotFoundError("repo", id);
    return repo;
  }

  deleteRepo(id: string): void {
    this.run(`DELETE FROM repos WHERE id=?`, id);
  }

  /** Flows that still point at this repo (`flows.repo_id`). */
  countFlowsByRepoId(repoId: string): number {
    const row = this.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flows WHERE repo_id=?`,
      repoId,
    );
    return row?.n ?? 0;
  }
}

export { DatabaseMigrationError } from "./database-migration-error";
export { SCHEMA_USER_VERSION } from "./schema-version";

/** Shared application database. */
export const db = processSingleton("db", () => new Database());
