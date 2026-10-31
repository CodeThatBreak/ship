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
      expect(db.get<{ user_version: number }>(`PRAGMA user_version`)?.user_version).toBe(3);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("sets user_version 3 and seeds built-in templates on a fresh DB", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    expect(db.get<{ user_version: number }>(`PRAGMA user_version`)?.user_version).toBe(3);
    expect(db.get(`SELECT 1 AS ok FROM flow_templates WHERE id='tpl_sdlc_loop'`)).toEqual({ ok: 1 });
  });

  it("schema.sql defines columns expected by row mappers (flows, nodes, runs)", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();
    const flowCols = db.all<{ name: string }>(`PRAGMA table_info(flows)`).map((c) => c.name);
    for (const col of ["execution_mode", "repo_id", "template_id", "trigger_payload"]) {
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
