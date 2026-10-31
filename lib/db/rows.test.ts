import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../tests/helpers/in-memory-db";

assignDatabasePath(createIsolatedDatabasePath("devflow-rows-"));

const { db } = await import("./index");
const { rows, TaskRow, Task, NodeRow } = await import("./rows");

const now = () => new Date().toISOString();

describe("RowGateway", () => {
  it("parses a task row and hydrates provider fields on the Task transform", () => {
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, fields, synced_at)
       VALUES (?,?,?,?,?,?,?)`,
      "task_1",
      "generic",
      "TST-1",
      "summary",
      "open",
      JSON.stringify({ prd: "PRD text", figma_urls: ["https://figma.com/file/1"] }),
      now(),
    );

    const row = rows.get(TaskRow, `SELECT * FROM tasks WHERE id=?`, "task_1");
    expect(row?.key).toBe("TST-1");

    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, "task_1");
    expect(task?.prdText).toBe("PRD text");
    expect(task?.figmaUrls).toEqual(["https://figma.com/file/1"]);
  });

  it("rejects invalid JSON columns", () => {
    db.run(
      `INSERT INTO tasks (id, type, key, summary, fields) VALUES (?,?,?,?,?)`,
      "task_bad",
      "generic",
      "TST-2",
      "x",
      "{not-json",
    );
    expect(() => rows.get(TaskRow, `SELECT * FROM tasks WHERE id=?`, "task_bad")).toThrow();
  });

  it("parses node JSON input and output", () => {
    db.run(
      `INSERT INTO tasks (id, type, key, summary) VALUES (?,?,?,?)`,
      "task_n",
      "generic",
      "TST-N",
      "n",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "flw_n",
      "task_n",
      "flow",
      "active",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, input, output, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      "node_n",
      "flw_n",
      "plan",
      "plan",
      "pending",
      JSON.stringify({ ticket: "x" }),
      JSON.stringify({ ok: true }),
      now(),
      now(),
    );

    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE id=?`, "node_n");
    expect(node?.input).toEqual({ ticket: "x" });
    expect(node?.output).toEqual({ ok: true });
  });
});
