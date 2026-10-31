import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOW_CHILD_TABLES as ENGINE_FLOW_CHILD_TABLES } from "@/lib/engine/flow-engine";
import { AppConfig } from "@/lib/config";
import {
  deleteFlowCascade,
  FLOW_CHILD_TABLES as SEED_FLOW_CHILD_TABLES,
  resolveSeedDb,
} from "../scripts/lib/seed-db.mjs";
import { createIsolatedDatabasePath } from "./helpers/in-memory-db";

describe("seed-db FLOW_CHILD_TABLES", () => {
  it("matches FlowEngine delete order", () => {
    expect([...SEED_FLOW_CHILD_TABLES]).toEqual([...ENGINE_FLOW_CHILD_TABLES]);
  });
});

describe("DatabaseConfig.path", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("uses devflow.prod.db under production when DATABASE_PATH is unset", () => {
    delete process.env.DATABASE_PATH;
    vi.stubEnv("NODE_ENV", "production");
    const cfg = new AppConfig();
    expect(cfg.db.path()).toBe(path.resolve(AppConfig.root, "./data/devflow.prod.db"));
    expect(cfg.db.demoPath()).toBe(path.resolve(AppConfig.root, "./data/devflow.db"));
  });
});

describe("deleteFlowCascade", () => {
  it("removes child flows, hooks, and step_merges before the parent flow", () => {
    const dbPath = createIsolatedDatabasePath("devflow-seed-cascade-");
    const schema = fs.readFileSync(path.join(AppConfig.root, "lib/db/schema.sql"), "utf8");
    const db = new Database(dbPath);
    db.exec(schema);

    const taskId = "task_cascade";
    const parentId = "flow_parent";
    const childId = "flow_child";
    const ts = new Date().toISOString();

    db.prepare(`INSERT INTO tasks (id, type, key, summary) VALUES (?,?,?,?)`).run(
      taskId,
      "jira",
      "T-1",
      "summary",
    );

    db.prepare(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(parentId, taskId, "parent", "active", ts, ts);
    db.prepare(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(childId, taskId, "child", "active", parentId, ts, ts);

    db.prepare(
      `INSERT INTO step_merges (id,flow_id,parent_flow_id,parent_node,status,attempts,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("sm_1", childId, parentId, "build", "running", 0, ts, ts);

    db.prepare(
      `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run("hk_1", null, parentId, "plan", "secret", null, ts);

    deleteFlowCascade(db, parentId);

    expect(db.prepare(`SELECT id FROM flows WHERE id IN (?,?)`).all(parentId, childId)).toEqual([]);
    expect(db.prepare(`SELECT id FROM hooks WHERE flow_id=?`).all(parentId)).toEqual([]);
    expect(db.prepare(`SELECT id FROM step_merges WHERE parent_flow_id=?`).all(parentId)).toEqual([]);
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
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
    const other = createIsolatedDatabasePath("devflow-seed-guard-");
    process.env.DATABASE_PATH = other;
    delete process.env.SEED_ALLOW_NON_DEMO_DB;
    process.argv = process.argv.filter((a) => a !== "--allow-non-demo-db");

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    expect(() => resolveSeedDb(root)).toThrow(/exit:1/);
    expect(exit).toHaveBeenCalledWith(1);
    fs.rmSync(path.dirname(other), { recursive: true, force: true });
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
