import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOW_CHILD_TABLES as ENGINE_FLOW_CHILD_TABLES } from "@/lib/engine/constants/flowChildTables";
import { AppConfig } from "@/lib/config";
import {
  deleteFlowCascade,
  FLOW_CHILD_TABLES as SEED_FLOW_CHILD_TABLES,
  resolveSeedDb,
} from "../scripts/lib/seed-db.mjs";

describe("seed-db FLOW_CHILD_TABLES", () => {
  it("matches FlowEngine delete order", () => {
    expect([...SEED_FLOW_CHILD_TABLES]).toEqual([...ENGINE_FLOW_CHILD_TABLES]);
  });
});

describe("DatabaseConfig.url", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("uses the devflow_prod URL under production when DATABASE_URL is unset", () => {
    delete process.env.DATABASE_URL;
    vi.stubEnv("NODE_ENV", "production");
    const cfg = new AppConfig();
    expect(cfg.db.url()).toBe("postgresql://devflow:devflow@localhost:5432/devflow_prod");
    expect(cfg.db.demoUrl()).toBe("postgresql://devflow:devflow@localhost:5432/devflow");
  });
});

/**
 * Minimal scratch schema for the cascade characterization test — the tables
 * `deleteFlowCascade` sweeps, with just the columns the test inserts. The
 * legacy `lib/db/schema.sql` was deleted in the Postgres/Prisma era (the
 * Prisma schema is the source of truth); this inline DDL keeps the sqlite
 * contract test self-contained until it retires with better-sqlite3.
 */
const CASCADE_SCRATCH_SCHEMA = `
  CREATE TABLE tasks (id TEXT PRIMARY KEY, type TEXT, key TEXT, summary TEXT);
  CREATE TABLE flows (id TEXT PRIMARY KEY, task_id TEXT, name TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE hooks (id TEXT PRIMARY KEY, template_id TEXT, flow_id TEXT, node_key TEXT, secret TEXT, filter TEXT, created_at TEXT);
  CREATE TABLE plan_steps (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE events (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE messages (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE runs (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE artifacts (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE comments (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE branches (id TEXT PRIMARY KEY, flow_id TEXT);
  CREATE TABLE nodes (id TEXT PRIMARY KEY, flow_id TEXT);
`;

describe("deleteFlowCascade", () => {
  it("removes the flow's owned rows before the flow itself", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-seed-cascade-"));
    const dbPath = path.join(dir, "cascade.db");
    const db = new Database(dbPath);
    db.exec(CASCADE_SCRATCH_SCHEMA);

    const taskId = "task_cascade";
    const flowId = "flow_parent";
    const ts = new Date().toISOString();

    db.prepare(`INSERT INTO tasks (id, type, key, summary) VALUES (?,?,?,?)`).run(
      taskId,
      "jira",
      "T-1",
      "summary",
    );

    db.prepare(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(flowId, taskId, "parent", "active", ts, ts);

    db.prepare(
      `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run("hk_1", null, flowId, "plan", "secret", null, ts);

    deleteFlowCascade(db, flowId);

    expect(db.prepare(`SELECT id FROM flows WHERE id=?`).all(flowId)).toEqual([]);
    expect(db.prepare(`SELECT id FROM hooks WHERE flow_id=?`).all(flowId)).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveSeedDb allowlist", () => {
  const envSnapshot = { ...process.env };
  const argvSnapshot = [...process.argv];

  afterEach(() => {
    process.env = { ...envSnapshot };
    process.argv = [...argvSnapshot];
    vi.restoreAllMocks();
  });

  it("refuses non-demo paths without --allow-non-demo-db", () => {
    const root = AppConfig.root;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-seed-guard-"));
    const other = path.join(dir, "other.db");
    process.env.DATABASE_PATH = other;
    delete process.env.SEED_ALLOW_NON_DEMO_DB;
    process.argv = process.argv.filter((a) => a !== "--allow-non-demo-db");

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    expect(() => resolveSeedDb(root)).toThrow(/exit:1/);
    expect(exit).toHaveBeenCalledWith(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("accepts the demo DB path and logs the target", () => {
    const root = AppConfig.root;
    delete process.env.DATABASE_PATH;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const file = resolveSeedDb(root);
    expect(file).toBe(path.resolve(root, "./data/devflow.db"));
    expect(log).toHaveBeenCalledWith(`Seed target database: ${file}`);
  });
});
