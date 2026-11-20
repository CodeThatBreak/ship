import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("./app");
const { rows, TaskRow, Task, NodeRow, EventRow } = await import("./rows");
const { RowDecodeError } = await import("./rowDecodeError");

const TASK_SELECT = `SELECT id, type, key, summary, description, status,
       issue_type AS "issueType", priority, repo_url AS "repoUrl",
       parent_key AS "parentKey", external_url AS "externalUrl", raw,
       synced_at AS "syncedAt", fields FROM tasks`;
const EVENT_SELECT = `SELECT id, flow_id AS "flowId", node_id AS "nodeId", type, message, data,
       created_at AS "createdAt" FROM events`;
const NODE_SELECT = `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status,
       attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef",
       session_id AS "sessionId", label, config,
       join_mode AS "joinMode", input, output, created_at AS "createdAt",
       updated_at AS "updatedAt" FROM nodes`;

const now = () => new Date().toISOString();

describe("RowGateway", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("parses a task row and hydrates provider fields on the Task transform", async () => {
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, fields, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      "task_1",
      "generic",
      "TST-1",
      "summary",
      "open",
      JSON.stringify({ prd: "PRD text", figmaUrls: ["https://figma.com/file/1"] }),
      now(),
    );

    const row = await rows.get(TaskRow, `${TASK_SELECT} WHERE id=$1`, "task_1");
    expect(row?.key).toBe("TST-1");

    const task = await rows.get(Task, `${TASK_SELECT} WHERE id=$1`, "task_1");
    expect(task?.prdText).toBe("PRD text");
    expect(task?.figmaUrls).toEqual(["https://figma.com/file/1"]);
  });

  it("rejects rows missing required columns", async () => {
    // JSONB is always valid at the DB layer; a malformed row is one whose
    // shape violates the schema (here: a missing `type` via a narrow select).
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, fields) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      "task_bad",
      "generic",
      "TST-2",
      "x",
      "{}",
    );
    await expect(
      rows.get(TaskRow, `SELECT id, key, summary FROM tasks WHERE id=$1`, "task_bad"),
    ).rejects.toThrow(RowDecodeError);
  });

  it("skips undecodable rows in all() without failing the whole query", async () => {
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, fields) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      "task_skip",
      "generic",
      "TST-SKIP-OK",
      "ok",
      "{}",
    );
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, fields) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      "task_skip_bad",
      "generic",
      "TST-SKIP-BAD",
      "bad",
      "{}",
    );
    // the "bad" row here is missing `type` in the projection → schema mismatch
    const keys = (
      await rows.all(
        TaskRow,
        `SELECT id, key, summary, description, status,
                issue_type AS "issueType", priority, repo_url AS "repoUrl",
                parent_key AS "parentKey", external_url AS "externalUrl", raw,
                synced_at AS "syncedAt", fields,
                CASE WHEN key = 'TST-SKIP-OK' THEN type ELSE NULL END AS type
         FROM tasks WHERE key LIKE 'TST-SKIP-%' ORDER BY key`,
      )
    ).map((t) => t.key);
    expect(keys).toEqual(["TST-SKIP-OK"]);
  });

  it("tolerates non-object events.data in the feed", async () => {
    await db.run(`DELETE FROM events WHERE flow_id=$1`, "flw_ev");
    await db.run(`INSERT INTO tasks (id, type, key, summary) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, "task_ev", "generic", "TST-E", "e");
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,'active',$4,$5) ON CONFLICT (id) DO NOTHING`,
      "flw_ev",
      "task_ev",
      "flow",
      now(),
      now(),
    );
    await db.run(
      `INSERT INTO events (id, flow_id, type, message, data, created_at) VALUES ($1,$2,'log','x',$3::jsonb,$4)`,
      "ev_bad",
      "flw_ev",
      JSON.stringify(["not", "an", "object"]),
      now(),
    );
    const event = await rows.get(EventRow, `${EVENT_SELECT} WHERE id=$1`, "ev_bad");
    expect(event?.data).toBeNull();
  });

  it("parses node JSONB input and output", async () => {
    await db.run(`INSERT INTO tasks (id, type, key, summary) VALUES ($1,$2,$3,$4)`, "task_n", "generic", "TST-N", "n");
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,'active',$4,$5) ON CONFLICT (id) DO NOTHING`,
      "flw_n",
      "task_n",
      "flow",
      now(),
      now(),
    );
    await db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, input, output, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending',$5::jsonb,$6::jsonb,$7,$8)`,
      "node_n",
      "flw_n",
      "plan",
      "plan",
      JSON.stringify({ ticket: "x" }),
      JSON.stringify({ ok: true }),
      now(),
      now(),
    );

    const node = await rows.get(NodeRow, `${NODE_SELECT} WHERE id=$1`, "node_n");
    expect(node?.input).toEqual({ ticket: "x" });
    expect(node?.output).toEqual({ ok: true });
  });
});
