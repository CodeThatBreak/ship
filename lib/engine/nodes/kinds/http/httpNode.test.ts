import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);
const { HttpTemplateNode } = await import("./httpNode");
import type { AgentRunResult } from "../../../ports/agentPort";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeRow } from "../../../../db/rows";

const now = () => new Date().toISOString();

describe("HttpTemplateNode.recover", () => {
  it("declines recovery with no side effects when the run finished offline", async () => {
    const taskId = "task_http_recover";
    const flowId = "flw_http_recover";
    const nodeId = "node_http_recover";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId,
      "generic",
      "HTTP-1",
      "http recover",
      "open",
      "story",
      "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId,
      taskId,
      "http recover",
      "active",
      now(),
      now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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
    const nodeRow = await testGet<NodeRow>(`SELECT * FROM nodes WHERE id=$1`, nodeId);
    if (!nodeRow) throw new Error("missing node row");

    const ok = await node.recover(ctx, nodeRow, { status: "finished" } satisfies AgentRunResult, "server restarted");
    expect(ok).toMatchObject({ kind: "manual" });

    const after = await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId);
    expect(after?.status).toBe("running");
    const errors = await testAll<{ type: string }>(`SELECT type FROM events WHERE node_id=$1`, nodeId);
    expect(errors.some((e) => e.type === "error")).toBe(false);
  });
});
