import "server-only";

import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { normalizeModelSpec } from "../modelSpec";
import { processSingleton } from "../singleton";

export interface Repo {
  id: string;
  name: string;
  cloud_url: string;
  local_path: string | null;
  default_branch: string;
  // worktree setup policy (Phase 2): per-repo overrides for the dep-policy table
  install_command: string | null;
  skip_install: number; // sqlite boolean 0/1
  sync_paths: string | null;
  shared_dirs: string | null;
  setup_command: string | null;
  worktree_timeout_ms: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * The application database (better-sqlite3, WAL mode).
 *
 * Owns the connection lifecycle, schema bootstrap and idempotent migrations,
 * plus the low-level query helpers (get/all/run) and the small domain stores
 * (messages, events, settings, repos) that don't warrant their own class yet.
 */
export class Database {
  private conn: SqliteDatabase.Database | null = null;

  /** Lazily open (and migrate) the connection. */
  connection(): SqliteDatabase.Database {
    if (this.conn) return this.conn;
    const file = config.db.path();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.conn = new SqliteDatabase(file);
    this.conn.pragma("journal_mode = WAL");
    // The tickets→tasks table rename must run BEFORE schema.sql — its
    // CREATE TABLE IF NOT EXISTS tasks would otherwise create a fresh empty
    // `tasks` table on existing DBs and shadow the old `tickets` data.
    this.renameTicketsToTasks(this.conn);
    const schema = fs.readFileSync(
      path.join(process.cwd(), "lib/db/schema.sql"),
      "utf8"
    );
    this.conn.exec(schema);
    this.migrate(this.conn, schema);
    return this.conn;
  }

  /**
   * Table rename part of the tickets→tasks migration (idempotent): renames
   * `tickets` to `tasks` when only the old table exists (existing DBs). On a
   * fresh DB neither exists and schema.sql creates `tasks` directly. SQLite
   * rewrites REFERENCES clauses on RENAME, so flows' FK follows along — the
   * column-level migration in migrate() verifies that below.
   */
  private renameTicketsToTasks(d: SqliteDatabase.Database): void {
    const hasTable = (t: string) =>
      !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (!hasTable("tasks") && hasTable("tickets")) {
      d.exec(`ALTER TABLE tickets RENAME TO tasks`);
    }
  }

  /** Add columns introduced after the initial schema (idempotent). */
  private migrate(d: SqliteDatabase.Database, schemaSql: string): void {
    const cols = (table: string) =>
      new Set(d.prepare(`PRAGMA table_info(${table})`).all().map((c: any) => c.name));
    // ── Tickets → Tasks (task-model rename, no behavior change) ─────────────
    // `tickets` is now `tasks` (a `type` discriminator + provider-specific
    // `fields` JSON are added; common columns stay as-is for now). SQLite
    // rewrites REFERENCES clauses on RENAME, so flows' FK follows the table
    // rename — verified below, with a defensive flows-table recreation when
    // an engine leaves a dangling FK behind.
    this.migrateTicketsToTasks(d);
    this.migrateLegacyTicketRefs(d);
    this.migrateTaskColumnShape(d, schemaSql);
    const flowsCols = cols("flows");
    if (!flowsCols.has("execution_mode")) {
      d.exec(`ALTER TABLE flows ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'cloud'`);
    }
    if (!flowsCols.has("repo_id")) {
      d.exec(`ALTER TABLE flows ADD COLUMN repo_id TEXT REFERENCES repos(id)`);
    }
    const nodeCols = cols("nodes");
    if (!nodeCols.has("session_id")) {
      d.exec(`ALTER TABLE nodes ADD COLUMN session_id TEXT`); // local cursor-agent session
    }
    // Phase 2: per-run prompt override
    if (!nodeCols.has("prompt_override")) {
      d.exec(`ALTER TABLE nodes ADD COLUMN prompt_override TEXT`);
    }
    // Phase 1A: cost & usage capture per run
    const runCols = cols("runs");
    const runAdd: [string, string][] = [
      ["model", "TEXT"],
      ["input_tokens", "INTEGER"],
      ["output_tokens", "INTEGER"],
      ["cache_read_tokens", "INTEGER"],
      ["cache_write_tokens", "INTEGER"],
      ["duration_ms", "INTEGER"],
      ["cost_cents", "INTEGER"],
      ["usage", "TEXT"], // raw usage JSON (future-proof)
    ];
    for (const [name, type] of runAdd) {
      if (!runCols.has(name)) {
        d.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
      }
    }
    // Phase 3C: branch_id on runs for per-branch attribution
    if (!runCols.has("branch_id")) {
      d.exec(`ALTER TABLE runs ADD COLUMN branch_id TEXT REFERENCES branches(id)`);
    }
    // ── Phase 1: custom flows — template layer ─────────────────────────────
    if (!nodeCols.has("label")) {
      d.exec(`ALTER TABLE nodes ADD COLUMN label TEXT`);
    }
    if (!nodeCols.has("config")) {
      d.exec(`ALTER TABLE nodes ADD COLUMN config TEXT`); // effective config snapshot (JSON)
    }
    if (!nodeCols.has("join_mode")) {
      d.exec(`ALTER TABLE nodes ADD COLUMN join_mode TEXT`);
    }
    if (!flowsCols.has("template_id")) {
      d.exec(`ALTER TABLE flows ADD COLUMN template_id TEXT REFERENCES flow_templates(id)`);
    }
    if (!flowsCols.has("trigger_payload")) {
      d.exec(`ALTER TABLE flows ADD COLUMN trigger_payload TEXT`); // JSON
    }
    // Node-template locality: the canvas creator persists declarative rows
    // scoped to one template — NULL stays the global Library row shared
    // across templates ("node_templates.template_id" added after launch).
    if (!cols("node_templates").has("template_id")) {
      d.exec(`ALTER TABLE node_templates ADD COLUMN template_id TEXT REFERENCES flow_templates(id)`);
    }
    // Worktrees (Phase 1): the per-flow git worktree dir for local runs —
    // set at build start, cleared on removal. The removal-record table lives
    // in schema.sql (CREATE IF NOT EXISTS is idempotent).
    if (!flowsCols.has("worktree_dir")) {
      d.exec(`ALTER TABLE flows ADD COLUMN worktree_dir TEXT`);
    }
    // Worktree setup policy (Phase 2): per-repo overrides for the dep-policy
    // table (lib/git/dep-policy.ts) — shell-command fields are trust boundaries.
    const repoCols = cols("repos");
    for (const [name, type] of [
      ["install_command", "TEXT"],
      ["skip_install", "INTEGER NOT NULL DEFAULT 0"],
      ["sync_paths", "TEXT"],
      ["shared_dirs", "TEXT"],
      ["setup_command", "TEXT"],
      ["worktree_timeout_ms", "INTEGER"],
    ] as const) {
      if (!repoCols.has(name)) {
        d.exec(`ALTER TABLE repos ADD COLUMN ${name} ${type}`);
      }
    }
    // Pipeline gate node (order 25, between build and review): backfill a node
    // row for pre-gate flows that were created before the node existed. Only
    // flows whose template's graph contains a pipeline node get one — Phase 2
    // custom templates without a gate must keep their snapshotted node set.
    // The standalone pipeline_fix node was folded into the gate — drop its
    // rows (fix history stays in the events log). Runs AFTER flows.template_id
    // exists (the query matches templates; a fresh DB adds that column above).
    {
      const missing = d.prepare(
        `SELECT f.id FROM flows f
         WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.flow_id=f.id AND n.node_key='pipeline')
           AND EXISTS (SELECT 1 FROM flow_template_nodes t WHERE t.template_id=f.template_id AND t.node_key='pipeline')`
      ).all() as { id: string }[];
      if (missing.length) {
        const insert = d.prepare(
          `INSERT INTO nodes (id,flow_id,node_key,type,status,created_at,updated_at) VALUES (?,?,?,'pipeline','pending',?,?)`
        );
        const now = new Date().toISOString();
        for (const f of missing) {
          insert.run(`node_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`, f.id, "pipeline", now, now);
        }
      }
      const legacy = d.prepare(`SELECT id FROM nodes WHERE node_key='pipeline_fix'`).all() as { id: string }[];
      if (legacy.length) {
        const delArtifacts = d.prepare(`DELETE FROM artifacts WHERE node_id=?`);
        const delRuns = d.prepare(`DELETE FROM runs WHERE node_id=?`);
        const delNode = d.prepare(`DELETE FROM nodes WHERE id=?`);
        for (const n of legacy) {
          delArtifacts.run(n.id);
          delRuns.run(n.id);
          delNode.run(n.id);
        }
      }
    }
    // ── Phase 4: triggers ──────────────────────────────────────────────────
    // next fire time for a `schedule` flow trigger (hook_deliveries lives in
    // schema.sql — CREATE IF NOT EXISTS is idempotent)
    if (!cols("flow_templates").has("schedule_next_at")) {
      d.exec(`ALTER TABLE flow_templates ADD COLUMN schedule_next_at TEXT`);
    }
    // ── Plan fan-out: step sub-flows (Phase 1A) ─────────────────────────────
    // Child flows reference their parent; `kind` distinguishes step children
    // from SDLC flows so list/count queries can filter them; plan steps link
    // to the child flow that builds them; auto-wrapped child templates are
    // hidden from the gallery; step_merges makes merge-back resumable.
    const stepFlowAdd: [string, string][] = [
      ["parent_flow_id", "TEXT REFERENCES flows(id)"],
      ["kind", "TEXT NOT NULL DEFAULT 'sdlc'"],
    ];
    for (const [name, type] of stepFlowAdd) {
      if (!flowsCols.has(name)) {
        d.exec(`ALTER TABLE flows ADD COLUMN ${name} ${type}`);
      }
    }
    if (!cols("plan_steps").has("sub_flow_id")) {
      d.exec(`ALTER TABLE plan_steps ADD COLUMN sub_flow_id TEXT REFERENCES flows(id)`);
    }
    if (!cols("flow_templates").has("hidden")) {
      d.exec(`ALTER TABLE flow_templates ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
    }
    // step_merges lives in schema.sql (CREATE IF NOT EXISTS is idempotent).
    this.seedTemplates(d);
    // Wait-source neutrality (Phase 1): node triggers persisted with the old
    // GitLab-prefixed sources ("gitlab_pipeline"/"gitlab_comments") remap to
    // the neutral ones ("pipeline"/"comments") — one-shot, idempotent.
    d.exec(
      `UPDATE flow_template_nodes
       SET trigger=REPLACE(REPLACE(trigger,'gitlab_pipeline','pipeline'),'gitlab_comments','comments')
       WHERE trigger LIKE '%gitlab%'`
    );
    // Legacy flows predate templates — bind them to the seeded SDLC template so
    // the engine's template-derived roles (gate chain, graph) apply unchanged.
    d.exec(`UPDATE flows SET template_id='tpl_sdlc_loop' WHERE template_id IS NULL`);
    // ── legacy data normalization (retires the read-side compat paths) ─────
    this.normalizeLegacyModelSpecs(d);
    this.normalizeLegacyFlowTriggers(d);
    this.normalizeLegacyComments(d);
  }

  /**
   * Legacy data fix: model ids stored with bracket params before the
   * write-path normalization (`runs.model`, plus `model` overrides in node /
   * template-node configs). Valueless `fast` params are dropped, the
   * meaningful `fast=true`/`fast=false` picks and other params kept verbatim
   * — identical semantics to `normalizeModelSpec`.
   * Idempotent: only rows whose value changes are written back.
   */
  private normalizeLegacyModelSpecs(d: SqliteDatabase.Database): void {
    for (const [table, column] of [
      ["runs", "model"],
      ["nodes", "config"],
      ["flow_template_nodes", "config"],
    ] as const) {
      if (!this.hasTable(d, table)) continue;
      const affected = d
        .prepare(`SELECT rowid AS id, ${column} AS v FROM ${table} WHERE v LIKE '%[%'`)
        .all() as { id: number | string; v: string }[];
      const update = d.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
      for (const r of affected) {
        let next: string | null = null;
        if (table === "runs") {
          next = normalizeModelSpec(r.v);
        } else {
          try {
            const cfg = JSON.parse(r.v) as Record<string, unknown>;
            if (cfg && typeof cfg === "object" && typeof (cfg as Record<string, unknown>).model === "string") {
              const nv = normalizeModelSpec((cfg as { model: string }).model);
              if (nv !== (cfg as { model: string }).model) {
                cfg.model = nv;
                next = JSON.stringify(cfg);
              }
            }
          } catch {
            // not JSON / not a node config shape — leave untouched
          }
        }
        if (next !== null && next !== r.v) update.run(next, r.id);
      }
    }
  }

  /**
   * Legacy data fix: flow triggers persisted with the retired `webhook` type
   * (the type carried no runtime behavior — every template's flows can always
   * be started by manual pick or hook delivery) remap to `manual`, keeping the
   * surrounding keys (filter / repo_id / task_type) verbatim. One-shot,
   * idempotent.
   */
  private normalizeLegacyFlowTriggers(d: SqliteDatabase.Database): void {
    if (!this.hasTable(d, "flow_templates")) return;
    const affected = d
      .prepare(`SELECT id, trigger FROM flow_templates WHERE trigger LIKE '%"type":"webhook"%'`)
      .all() as { id: string; trigger: string }[];
    const update = d.prepare(`UPDATE flow_templates SET trigger=? WHERE id=?`);
    for (const t of affected) {
      try {
        const trig = JSON.parse(t.trigger) as Record<string, unknown>;
        if (trig && trig.type === "webhook") {
          trig.type = "manual";
          update.run(JSON.stringify(trig), t.id);
        }
      } catch {
        // unparseable trigger JSON — the read-side normalizer defaults it anyway
      }
    }
  }

  /**
   * Legacy data fix: comments ingested before normalization carry the raw
   * git-host note JSON in `comments.raw` (`position.new_path` / snake_case
   * `created_at` / author object). Rewrite those rows to the normalized
   * `HostComment` JSON shape every ingested row gets today, sourcing the
   * column-backed fields verbatim. One-shot, idempotent — normalized rows
   * carry a top-level `createdAt` and are skipped.
   */
  private normalizeLegacyComments(d: SqliteDatabase.Database): void {
    if (!this.hasTable(d, "comments")) return;
    const legacy = d
      .prepare(`SELECT id, raw, discussion_id, author, body, status, created_at FROM comments`)
      .all() as {
      id: string; raw: string | null; discussion_id: string | null;
      author: string | null; body: string; status: string; created_at: string;
    }[];
    for (const c of legacy) {
      let parsed: Record<string, unknown> | null = null;
      try { parsed = c.raw ? (JSON.parse(c.raw) as Record<string, unknown>) : null; } catch { parsed = null; }
      const p = parsed && typeof parsed === "object" ? parsed : null;
      // normalized rows carry createdAt (camelCase); anything else is a
      // pre-normalization git-host note — GitLab shape: position.* + created_at
      if (!p || typeof p.createdAt === "string") continue;
      if (p.created_at === undefined && p.position === undefined) continue;
      const position = (p.position ?? null) as { new_path?: string; new_line?: number } | null;
      const rawAuthor = p.author;
      const hostAuthor =
        typeof rawAuthor === "string" ? rawAuthor
        : rawAuthor && typeof rawAuthor === "object" && "username" in (rawAuthor as Record<string, unknown>)
          ? String((rawAuthor as { username: unknown }).username)
          : null;
      const normalized = {
        id: c.id,
        threadId: c.discussion_id,
        body: c.body,
        author: c.author ?? hostAuthor,
        resolvable: typeof p.resolvable === "boolean" ? p.resolvable : true,
        resolved: typeof p.resolved === "boolean" ? p.resolved : c.status === "resolved",
        system: false,
        path: (typeof p.path === "string" ? p.path : null) ?? position?.new_path ?? null,
        line: (typeof p.line === "number" ? p.line : null) ?? position?.new_line ?? null,
        createdAt: typeof p.created_at === "string" ? p.created_at : c.created_at,
      };
      d.prepare(`UPDATE comments SET author=?, raw=? WHERE id=?`)
        .run(normalized.author, JSON.stringify(normalized), c.id);
    }
  }

  /** Table-existence guard for data fixes (mirrors the migrate() cols() pattern). */
  private hasTable(d: SqliteDatabase.Database, table: string): boolean {
    return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  }

  /**
   * Column part of the tickets→tasks migration (task model, Phase 1) plus the
   * Phase-4 cleanup data fixes. Idempotent:
   *  - new `type` / `fields` columns on tasks (the table rename itself runs
   *    pre-schema — see renameTicketsToTasks); jira-only payload (`prd_text`,
   *    `figma_urls`) is copied into `fields` and the shared columns dropped
   *  - `flows.ticket_id` → `flows.task_id`, FK verified to resolve to
   *    tasks(id) — the table is recreated (data copied) when the reference
   *    dangles on an old `tickets` name
   */
  private migrateTicketsToTasks(d: SqliteDatabase.Database): void {
    const hasTable = (t: string) =>
      !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (hasTable("tasks")) {
      const taskCols = new Set(
        d.prepare(`PRAGMA table_info(tasks)`).all().map((c: any) => c.name)
      );
      if (!taskCols.has("type")) {
        d.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'jira'`);
      }
      if (!taskCols.has("fields")) {
        d.exec(`ALTER TABLE tasks ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'`); // provider-specific JSON
      }
      // Phase 4: jira-only payload leaves the shared columns — rows synced
      // before Phase 2 carry prd / figma_urls ONLY there (`fields` was still
      // `{}` then), so copy them across before the columns go away.
      if (taskCols.has("prd_text") || taskCols.has("figma_urls")) {
        const copy = d.prepare(
          `SELECT id, prd_text, figma_urls, fields FROM tasks WHERE prd_text IS NOT NULL OR figma_urls IS NOT NULL`
        ).all() as { id: string; prd_text: string | null; figma_urls: string | null; fields: string | null }[];
        const update = d.prepare(`UPDATE tasks SET fields=? WHERE id=?`);
        for (const r of copy) {
          const f = parseJsonObject(r.fields);
          let changed = false;
          if (typeof f.prd !== "string" && r.prd_text != null) {
            f.prd = r.prd_text;
            changed = true;
          }
          if (!Array.isArray(f.figma_urls) && typeof r.figma_urls === "string") {
            try {
              const urls = JSON.parse(r.figma_urls);
              if (Array.isArray(urls)) {
                f.figma_urls = urls;
                changed = true;
              }
            } catch { /* unparseable figma column — fields wins */ }
          }
          if (changed) update.run(JSON.stringify(f), r.id);
        }
        // DROP COLUMN needs SQLite ≥3.35 (bundled better-sqlite3 ships ≥3.53);
        // left in place on older builds — harmless leftover columns.
        if (taskCols.has("prd_text")) d.exec(`ALTER TABLE tasks DROP COLUMN prd_text`);
        if (taskCols.has("figma_urls")) d.exec(`ALTER TABLE tasks DROP COLUMN figma_urls`);
      }
    }
    // flows.ticket_id → flows.task_id
    const flowCols = new Set(
      d.prepare(`PRAGMA table_info(flows)`).all().map((c: any) => c.name)
    );
    if (!flowCols.has("task_id") && flowCols.has("ticket_id")) {
      d.exec(`ALTER TABLE flows RENAME COLUMN ticket_id TO task_id`);
    }
    // FK integrity: flows.task_id must reference tasks(id). The rename rewrites
    // the REFERENCES target; recreate flows (copying every column) if it dangles.
    const fks = d.prepare(`PRAGMA foreign_key_list(flows)`).all() as
      { from: string; table: string; to: string }[];
    const taskFk = fks.find((f) => f.from === "task_id");
    if (!taskFk || taskFk.table !== "tasks") {
      const info = d.prepare(`PRAGMA table_info(flows)`).all() as any[];
      const colDef = (c: any) =>
        `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}`
        + (c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : "")
        + (c.pk ? " PRIMARY KEY" : "");
      const colNames = info.map((c) => c.name).join(", ");
      const toCol = taskFk?.to ?? "id";
      d.exec(
        `CREATE TABLE flows_new (${info.map(colDef).join(", ")}, ` +
        `FOREIGN KEY (task_id) REFERENCES tasks(${toCol}))`
      );
      d.exec(`INSERT INTO flows_new (${colNames}) SELECT ${colNames} FROM flows`);
      d.exec(`DROP TABLE flows`);
      d.exec(`ALTER TABLE flows_new RENAME TO flows`);
    }
  }

  /**
   * Phase-4 legacy-ref data fix: the `{{ticket.*}}` alias retired with the
   * cleanup — but templates and flow snapshots saved before Phase 3 still
   * hold such refs in their stored JSON. Rewrite them to `{{task.*}}` (they
   * resolve the same context object) so nothing breaks once the alias leaves
   * the runtime context map. Idempotent: only rows whose text changes are
   * written back.
   */
  private migrateLegacyTicketRefs(d: SqliteDatabase.Database): void {
    const remap = (raw: unknown): string | null => {
      if (typeof raw !== "string" || !raw.includes("ticket")) return null;
      const next = raw.replace(/\{\{\s*ticket(?=[.}\s])/g, "{{task");
      return next !== raw ? next : null;
    };
    // (table, column) pairs holding template-authored text: template graphs,
    // declarative node definitions, flow config snapshots, prompt overrides,
    // flow triggers. Historical event/artifact content is left untouched.
    const targets: [string, string][] = [
      ["flow_templates", "trigger"],
      ["flow_template_nodes", "config"],
      ["flow_template_nodes", "input_map"],
      ["node_templates", "config"],
      ["nodes", "config"],
      ["nodes", "prompt_override"],
    ];
    for (const [table, col] of targets) {
      if (!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table)) continue;
      const columnNames = new Set(
        (d.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name)
      );
      if (!columnNames.has(col)) continue;
      const rows = d.prepare(
        `SELECT rowid AS id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%ticket%'`
      ).all() as unknown as { id: number | string; v: string | null }[];
      const update = d.prepare(`UPDATE ${table} SET ${col}=? WHERE rowid=?`);
      for (const r of rows) {
        const next = remap(r.v);
        if (next != null) update.run(next, r.id);
      }
    }
  }

  /**
   * Pristine Phase-1 task-shape migration (idempotent):
   *  - `tasks.jira_url` → `tasks.external_url` (generic external deep link;
   *    values copied across before the column drops)
   *  - `tasks.type` loses its `'jira'` DEFAULT — the provider/engine always
   *    sets the discriminator explicitly. SQLite needs a table rebuild to
   *    change a column default; the fresh definition comes from schema.sql.
   */
  private migrateTaskColumnShape(d: SqliteDatabase.Database, schemaSql: string): void {
    const info = d.prepare(`PRAGMA table_info(tasks)`).all() as any[];
    const colNames = new Set(info.map((c) => c.name));
    if (!info.length) return;
    if (colNames.has("jira_url") && !colNames.has("external_url")) {
      d.exec(`ALTER TABLE tasks ADD COLUMN external_url TEXT`);
      d.exec(`UPDATE tasks SET external_url=jira_url`);
      d.exec(`ALTER TABLE tasks DROP COLUMN jira_url`);
      colNames.delete("jira_url");
      colNames.add("external_url");
    }
    const typeCol = info.find((c) => c.name === "type");
    if (typeCol && String(typeCol.dflt_value ?? "").includes("jira")) {
      // recreate `tasks` from the canonical schema.sql definition (comment
      // lines in the DDL are inert in exec())
      const def = schemaSql.match(/CREATE TABLE IF NOT EXISTS tasks \([\s\S]*?\);/)?.[0];
      if (!def) return;
      d.exec(
        def.replace("IF NOT EXISTS ", "").replace("CREATE TABLE tasks", "CREATE TABLE tasks_new")
      );
      const freshCols = new Set(
        (d.prepare(`PRAGMA table_info(tasks_new)`).all() as any[]).map((c) => c.name)
      );
      const src = [...colNames].filter((n) => freshCols.has(n));
      d.exec(`INSERT INTO tasks_new (${src.join(", ")}) SELECT ${src.join(", ")} FROM tasks`);
      // flows REFERENCES tasks(id) — SQLite rewrites REFERENCES clauses on
      // RENAME, but the interim DROP needs FKs suspended
      const fkWasOn = d.pragma("foreign_keys", { simple: true });
      d.pragma("foreign_keys = OFF");
      try {
        d.exec(`DROP TABLE tasks`);
        d.exec(`ALTER TABLE tasks_new RENAME TO tasks`);
      } finally {
        if (fkWasOn) d.pragma("foreign_keys = ON");
      }
    }
  }

  /**
   * Seed the built-in node templates and the SDLC flow template (§7 of the
   * custom-flows plan). Idempotent: deterministic ids + INSERT OR IGNORE.
   */  private seedTemplates(d: SqliteDatabase.Database): void {
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
    const hasSdlc = d.prepare(`SELECT 1 FROM flow_templates WHERE id='tpl_sdlc_loop'`).get();
    if (!hasSdlc) {
      d.prepare(
        `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
         VALUES ('tpl_sdlc_loop','SDLC loop','The built-in software development loop: plan → build → pipeline → review → resolve.',1,1,'{"type":"manual"}',?,?)`
      ).run(now, now);
      // (key, trigger JSON) — minutes mirrors the resolve quiet-period default
      const nodes: [string, string][] = [
        ["plan", '{"type":"manual"}'],
        ["build", '{"type":"approval"}'],
        ["pipeline", '{"type":"auto","wait_for":"pipeline"}'],
        ["review", '{"type":"auto"}'],
        ["resolve", '{"type":"debounced","minutes":10,"wait_for":"comments"}'],
      ];
      for (const [key, trigger] of nodes) {
        const id = `ftn_${key}`;
        const nodeTemplateId = `nt_${key}`;
        d.prepare(
          `INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
           VALUES (?,?,?,?,NULL,?,'all','{}','{}',?,?)`
        ).run(id, "tpl_sdlc_loop", key, nodeTemplateId, trigger, now, now);
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
        ["plan", "build", "next", null],
        ["build", "pipeline", "next", null],
        ["pipeline", "review", "next", null],
        ["review", "resolve", "next", null],
        ["resolve", "pipeline", "loop", "nodes.resolve.output.codeChanged = true"],
      ];
      edges.forEach(([from, to, kind, condition]) => {
        eStmt.run(`fte_${from}_${to}`, "tpl_sdlc_loop", from, to, kind, null, condition, now, now);
      });
    } else {
      // migrate older seedings: the display-only `resolve → review` loop edge
      // becomes the real re-entry `resolve → pipeline` edge (conditioned on
      // the resolve output contract). Idempotent: deterministic edge ids, and
      // existing running flows keep their snapshotted graph semantics.
      d.prepare(
        `DELETE FROM flow_template_edges
         WHERE template_id='tpl_sdlc_loop' AND id='fte_resolve_review'
           AND from_key='resolve' AND kind='loop'`
      ).run();
      d.prepare(
        `INSERT OR IGNORE INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
         VALUES ('fte_resolve_pipeline','tpl_sdlc_loop','resolve','pipeline','loop',NULL,?, ?,?)`
      ).run("nodes.resolve.output.codeChanged = true", now, now);
    }

    // ── Plan fan-out: the built-in step template (Phase 1A) ─────────────────
    // The child template a fan-out `build` node defaults to (`child` unset):
    // one node instance of the step_build builtin def with an approval trigger
    // — the per-step gate. The StepFlowManager snapshots it per child flow and
    // feeds the {plan, step, siblings} trigger payload. `hidden` keeps it out
    // of the gallery (it is a child template; the fan-out knob references it
    // by id, never the picker).
    if (!d.prepare(`SELECT 1 FROM flow_templates WHERE id='tpl_step_build'`).get()) {
      d.prepare(
        `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,hidden,created_at,updated_at)
         VALUES ('tpl_step_build','Step build','One plan step built by its own child flow — per-step branch, diff and approval gate (fan-out child of the build node).',1,1,'{"type":"manual"}',1,?,?)`
      ).run(now, now);
      d.prepare(
        `INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
         VALUES ('ftn_tpl_step_build_step_build','tpl_step_build','step_build','nt_step_build',NULL,'{"type":"approval"}','all','{}','{}',?,?)`
      ).run(now, now);
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
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // ── typed row helpers ────────────────────────────────────────────────────
  get<T = any>(sql: string, ...args: any[]): T | undefined {
    return this.connection().prepare(sql).get(...args) as T | undefined;
  }

  all<T = any>(sql: string, ...args: any[]): T[] {
    return this.connection().prepare(sql).all(...args) as T[];
  }

  run(sql: string, ...args: any[]) {
    return this.connection().prepare(sql).run(...args);
  }

  // ── messages ─────────────────────────────────────────────────────────────
  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string
  ): void {
    this.run(
      `INSERT INTO messages (id, flow_id, node_key, role, content, created_at)
       VALUES (?,?,?,?,?,?)`,
      this.uid("msg_"), flowId, nodeKey, role, content, this.now()
    );
  }

  listMessages(flowId: string) {
    return this.all<any>(
      `SELECT * FROM messages WHERE flow_id=? ORDER BY created_at, id`, flowId
    );
  }

  // ── events ───────────────────────────────────────────────────────────────
  emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: any
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
  getSetting<T = any>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>(`SELECT value FROM settings WHERE key=?`, key);
    if (!row) return fallback;
    try { return JSON.parse(row.value) as T; } catch { return fallback; }
  }

  setSetting(key: string, value: any): void {
    this.run(
      `INSERT INTO settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      key,
      JSON.stringify(value)
    );
  }

  // ── repo registry ────────────────────────────────────────────────────────
  listRepos(): Repo[] {
    return this.all<Repo>(`SELECT * FROM repos ORDER BY name`);
  }

  repoById(id: string): Repo | undefined {
    return this.get<Repo>(`SELECT * FROM repos WHERE id=?`, id);
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
      this.run(
        `UPDATE repos SET name=?, cloud_url=?, local_path=?, default_branch=?,
         install_command=?, skip_install=?, sync_paths=?, shared_dirs=?, setup_command=?, worktree_timeout_ms=?, updated_at=? WHERE id=?`,
        input.name, cloudUrl, input.local_path ?? null, input.default_branch ?? "main",
        input.install_command ?? null, input.skip_install ? 1 : 0,
        input.sync_paths ?? null, input.shared_dirs ?? null, input.setup_command ?? null,
        input.worktree_timeout_ms ?? null,
        ts, input.id
      );
      return this.repoById(input.id)!;
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
    return this.repoById(id)!;
  }

  deleteRepo(id: string): void {
    this.run(`DELETE FROM repos WHERE id=?`, id);
  }
}

/** Defensive JSON-object parse for raw TEXT columns ({} when absent/invalid). */
function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Shared application database. */
export const db = processSingleton("db", () => new Database());
