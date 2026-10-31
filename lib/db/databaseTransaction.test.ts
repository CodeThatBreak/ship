import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-db-txn-")), "test.db");

describe("Database.transaction", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("rolls back all writes when the callback throws", async () => {
    process.env.DATABASE_PATH = mkDbPath();
    const { db } = await import("./app");
    db.connection();
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      "task_txn", "generic", "TXN-1", "hold", "open", "task", "P2",
    );

    expect(() =>
      db.transaction(() => {
        db.run(
          `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
          "flow_a", "task_txn", "A", "active", db.now(), db.now(),
        );
        db.run(
          `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
          "flow_b", "task_txn", "B", "active", db.now(), db.now(),
        );
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(db.get(`SELECT id FROM flows WHERE id=?`, "flow_a")).toBeUndefined();
    expect(db.get(`SELECT id FROM flows WHERE id=?`, "flow_b")).toBeUndefined();
  });
});
