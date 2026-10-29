/**
 * Vendor-neutralized run-handle migration (lib/db/index.ts): a DB created
 * with the old `cursor_agent_id` / `cursor_run_id` columns (runs + nodes)
 * must be renamed in place to `agent_ref` / `run_ref` on open, preserving
 * data. Fresh DBs get the new names straight from schema.sql.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import SqliteDatabase from "better-sqlite3";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-db-migrate-")), "test.db");
process.env.DATABASE_PATH = dbPath;

// Pre-create the legacy-shaped DB the migration must upgrade.
{
  const legacy = new SqliteDatabase(dbPath);
  legacy.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT, status TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE flows (
      id TEXT PRIMARY KEY,
      prompt TEXT, status TEXT, current_node TEXT, repo_id TEXT,
      task_id INTEGER REFERENCES tasks(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL REFERENCES flows(id),
      node_key TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      agent_id TEXT, cursor_agent_id TEXT,
      input TEXT, output TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(flow_id, node_key)
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL REFERENCES flows(id),
      node_id TEXT NOT NULL REFERENCES nodes(id),
      cursor_agent_id TEXT NOT NULL, cursor_run_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.prepare(`INSERT INTO flows (id, prompt, status, created_at, updated_at) VALUES ('flw_1', 'p', 'running', '2026-01-01', '2026-01-01')`).run();
  legacy.prepare(`INSERT INTO nodes (id, flow_id, node_key, type, status, agent_id, cursor_agent_id, created_at, updated_at)
                  VALUES ('node_1', 'flw_1', 'build', 'build', 'running', 'agt_node', 'agt_node_ref', '2026-01-01', '2026-01-01')`).run();
  legacy.prepare(`INSERT INTO runs (id, flow_id, node_id, cursor_agent_id, cursor_run_id, status, created_at, updated_at)
                  VALUES ('run_1', 'flw_1', 'node_1', 'agt_legacy', 'runref_legacy', 'running', '2026-01-01', '2026-01-01')`).run();
  legacy.close();
}

// Opens + migrates (schema.sql is skipped for the legacy tables via IF NOT
// EXISTS; migrate() renames the vendor-named columns).
const { db, Database } = await import("./index");

describe("run-handle column migration (cursor_* → *_ref)", () => {
  it("renames the legacy columns on runs", () => {
    const cols = db.all<{ name: string }>(`PRAGMA table_info(runs)`).map((c) => c.name);
    expect(cols).toContain("agent_ref");
    expect(cols).toContain("run_ref");
    expect(cols).not.toContain("cursor_agent_id");
    expect(cols).not.toContain("cursor_run_id");
  });

  it("renames the legacy column on nodes", () => {
    const cols = db.all<{ name: string }>(`PRAGMA table_info(nodes)`).map((c) => c.name);
    expect(cols).toContain("agent_ref");
    expect(cols).not.toContain("cursor_agent_id");
  });

  it("preserves the data through the rename", () => {
    expect(
      db.get<{ id: string; agent_ref: string; run_ref: string }>(
        `SELECT id, agent_ref, run_ref FROM runs WHERE id='run_1'`,
      ),
    ).toEqual({ id: "run_1", agent_ref: "agt_legacy", run_ref: "runref_legacy" });
    expect(
      db.get<{ agent_ref: string | null }>(`SELECT agent_ref FROM nodes WHERE id='node_1'`)?.agent_ref,
    ).toBe("agt_node_ref");
  });

  it("is idempotent: reopening finds nothing to rename", () => {
    // a new Database instance pointed at the same file runs the full migrate
    // pass again — the renames must already be no-ops
    const reopened = new Database();
    const cols = reopened.connection().prepare(`PRAGMA table_info(runs)`).all()
      .map((c) => (c as { name: string }).name);
    expect(cols).toContain("run_ref");
    expect(cols).not.toContain("cursor_run_id");
  });
});

describe("refinement threads (messages.thread)", () => {
  it("migrates the thread column onto the legacy DB", () => {
    const cols = db
      .all<{ name: string }>(`PRAGMA table_info(messages)`)
      .map((c) => c.name);
    expect(cols).toContain("thread");
  });

  it("addMessage stores the thread (null = the main conversation)", () => {
    db.addMessage("flw_1", "plan", "user", "refine auth", "auth");
    db.addMessage("flw_1", "plan", "assistant", "sub-plan refined", "auth");
    db.addMessage("flw_1", "plan", "user", "plain message");
    // order-independent: same-millisecond inserts sort nondeterministically
    const threads = (db.listMessages("flw_1") as { thread: string | null }[]).map((r) => r.thread);
    expect(threads.filter((t) => t === "auth")).toHaveLength(2);
    expect(threads.filter((t) => t === null)).toHaveLength(1);
  });
});
