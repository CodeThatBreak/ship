/**
 * Merge-request service: gate/review reset must not clobber running nodes.
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);
const { MergeRequestService } = await import("./mergeRequestService/mergeRequestService");

const now = () => new Date().toISOString();

describe("MergeRequestService.resetGateReview", () => {
  it("skips running nodes and missing keys", async () => {
    const flowId = "flw_reset";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_r", "generic", "TST-R", "reset test", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, "task_r", "reset", "active", now(), now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "n_gate", flowId, "ci_gate", "pipeline", "running", now(), now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "n_review", flowId, "ai_review", "review", "done", now(), now(),
    );
    const svc = new MergeRequestService();
    await svc.resetGateReview(flowId, "ci_gate", "ai_review");
    expect((await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, "n_gate"))?.status).toBe("running");
    expect((await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, "n_review"))?.status).toBe("pending");
    await svc.resetGateReview(flowId, "missing_gate", null);
  });
});
