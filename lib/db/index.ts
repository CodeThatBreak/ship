import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { processSingleton } from "../singleton";

export interface Repo {
  id: string;
  name: string;
  cloud_url: string;
  local_path: string | null;
  default_branch: string;
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
    const schema = fs.readFileSync(
      path.join(process.cwd(), "lib/db/schema.sql"),
      "utf8"
    );
    this.conn.exec(schema);
    this.migrate(this.conn);
    return this.conn;
  }

  /** Add columns introduced after the initial schema (idempotent). */
  private migrate(d: SqliteDatabase.Database): void {
    const cols = (table: string) =>
      new Set(d.prepare(`PRAGMA table_info(${table})`).all().map((c: any) => c.name));
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
    // Pipeline gate node (order 25, between build and review): backfill a node
    // row for any flow created before the node existed. The standalone
    // pipeline_fix node was folded into the gate — drop its rows (fix history
    // stays in the events log).
    {
      const missing = d.prepare(
        `SELECT id FROM flows f WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.flow_id=f.id AND n.node_key='pipeline')`
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
  }

  // ── ids & timestamps ─────────────────────────────────────────────────────
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
  }): Repo {
    const ts = this.now();
    const cloudUrl = this.normalizeRepoUrl(input.cloud_url);
    if (input.id) {
      this.run(
        `UPDATE repos SET name=?, cloud_url=?, local_path=?, default_branch=?, updated_at=? WHERE id=?`,
        input.name, cloudUrl, input.local_path ?? null, input.default_branch ?? "main", ts, input.id
      );
      return this.repoById(input.id)!;
    }
    const id = this.uid("repo_");
    this.run(
      `INSERT INTO repos (id,name,cloud_url,local_path,default_branch,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      id, input.name, cloudUrl, input.local_path ?? null, input.default_branch ?? "main", ts, ts
    );
    return this.repoById(id)!;
  }

  deleteRepo(id: string): void {
    this.run(`DELETE FROM repos WHERE id=?`, id);
  }
}

/** Shared application database. */
export const db = processSingleton("db", () => new Database());
