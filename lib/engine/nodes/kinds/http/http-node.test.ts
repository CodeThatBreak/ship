import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-http-recover-")),
  "test.db",
);

const { db } = await import("../../../../db");
const { HttpTemplateNode } = await import("./http-node");
import type { AgentRunResult } from "../../../ports/agent-port";
import type { FlowCtx } from "../../shared";
import type { NodeRow } from "../../../../db/rows";

const now = () => new Date().toISOString();

describe("HttpTemplateNode.recover", () => {
  it("declines recovery with no side effects when the run finished offline", async () => {
    const taskId = "task_http_recover";
    const flowId = "flw_http_recover";
    const nodeId = "node_http_recover";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId,
      "generic",
      "HTTP-1",
      "http recover",
      "open",
      "story",
      "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId,
      taskId,
      "http recover",
      "active",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      nodeId,
      flowId,
      "http_call",
      "http",
      "running",
      now(),
      now(),
    );
    const ctx = {
      flow: { id: flowId, task_id: "task_http_recover", name: "http recover", status: "active", execution_mode: "cloud", created_at: now(), updated_at: now() },
      task: { id: "task_http_recover", type: "generic", key: "HTTP-1", summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
    } as unknown as FlowCtx;
    const node = new HttpTemplateNode({ id: "http_call", name: "HTTP", description: null, config: { url: "https://example.com", method: "GET" } });
    const nodeRow = db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, nodeId);
    if (!nodeRow) throw new Error("missing node row");

    const ok = await node.recover(ctx, nodeRow, { status: "finished" } satisfies AgentRunResult, "server restarted");
    expect(ok).toBe(false);

    const after = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId);
    expect(after?.status).toBe("running");
    const errors = db.all<{ type: string }>(`SELECT type FROM events WHERE node_id=?`, nodeId);
    expect(errors.some((e) => e.type === "error")).toBe(false);
  });
});
