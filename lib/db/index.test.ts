/**
 * Database bootstrap: canonical schema.sql, repo-root path resolution,
 * `PRAGMA user_version` migrations, and atomic connection open.
 *
 * Uses an isolated temp SQLite file (DATABASE_PATH before first import).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-db-")), "test.db");

describe("Database bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("loads schema from the repo root regardless of process.cwd()", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const prevCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cwd-"));
    process.chdir(tmp);
    try {
      const { db } = await import("./index");
      db.connection();
      expect(db.get<{ user_version: number }>(`PRAGMA user_version`)?.user_version).toBe(4);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("sets user_version 4 and seeds built-in templates on a fresh DB", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    expect(db.get<{ user_version: number }>(`PRAGMA user_version`)?.user_version).toBe(4);
    expect(db.get(`SELECT 1 AS ok FROM flow_templates WHERE id='tpl_sdlc_loop'`)).toEqual({ ok: 1 });
  });

  it("schema.sql defines columns expected by row mappers (flows, nodes, runs)", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    const flowCols = db.all<{ name: string }>(`PRAGMA table_info(flows)`).map((c) => c.name);
    for (const col of ["execution_mode", "repo_id", "template_id", "template_graph", "trigger_payload"]) {
      expect(flowCols).toContain(col);
    }
    const nodeCols = db.all<{ name: string }>(`PRAGMA table_info(nodes)`).map((c) => c.name);
    for (const col of ["session_id", "prompt_override", "label", "config", "join_mode", "attempt_id"]) {
      expect(nodeCols).toContain(col);
    }
    const runCols = db.all<{ name: string }>(`PRAGMA table_info(runs)`).map((c) => c.name);
    for (const col of ["model", "input_tokens", "output_tokens", "usage"]) {
      expect(runCols).toContain(col);
    }
  });

  it("throws DatabaseMigrationError and does not cache the connection when schema read fails", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { Database } = await import("./index");
    const { DatabaseMigrationError } = await import("./database-migration-error");
    const origRead = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...rest) => {
      if (String(p).endsWith("schema.sql")) throw new Error("ENOENT mock");
      return origRead(p, ...rest);
    });

    const instance = new Database();
    expect(() => instance.connection()).toThrow(DatabaseMigrationError);
    expect(() => instance.connection()).toThrow(DatabaseMigrationError);
  });

  it("uid() is strictly increasing within the same mocked millisecond", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    const ms = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => ms);
    const ids = [db.uid("ev_"), db.uid("ev_"), db.uid("ev_")];
    expect(ids[0] < ids[1] && ids[1] < ids[2]).toBe(true);
  });

  it("listEvents pages with id > after and listEventsTail returns newest window", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    db.run(
      `INSERT INTO tasks (id,type,fields,key,summary) VALUES ('t_ev','jira','{}','K-ev','s')`,
    );
    db.run(
      `INSERT INTO flows (id,task_id,name,status,created_at,updated_at) VALUES ('flw_ev','t_ev','n','active',datetime('now'),datetime('now'))`,
    );
    const ts = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO events (id,flow_id,node_id,type,message,data,created_at) VALUES (?,?,NULL,'s','a',NULL,?)`,
      "ev_a",
      "flw_ev",
      ts,
    );
    db.run(
      `INSERT INTO events (id,flow_id,node_id,type,message,data,created_at) VALUES (?,?,NULL,'s','b',NULL,?)`,
      "ev_b",
      "flw_ev",
      ts,
    );
    expect(db.listEvents("flw_ev", "ev_a", 10).map((r) => r.id)).toEqual(["ev_b"]);
    expect(db.listEventsTail("flw_ev", 1).map((r) => r.id)).toEqual(["ev_b"]);
  });

  it("addMessage stores messages.thread from the canonical schema", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    db.run(
      `INSERT INTO tasks (id,type,fields,key,summary) VALUES ('t1','jira','{}','K-1','s')`,
    );
    db.run(
      `INSERT INTO flows (id,task_id,name,status,created_at,updated_at) VALUES ('flw_1','t1','n','active',datetime('now'),datetime('now'))`,
    );
    db.addMessage("flw_1", "plan", "user", "refine auth", "auth");
    const row = db.get<{ thread: string | null }>(
      `SELECT thread FROM messages WHERE flow_id='flw_1' LIMIT 1`,
    );
    expect(row?.thread).toBe("auth");
  });
});
