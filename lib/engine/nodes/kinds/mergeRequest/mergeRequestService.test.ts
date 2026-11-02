/**
 * Merge-request service: gate/review reset must not clobber running nodes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-mr-service-")),
  "test.db",
);

const { db } = await import("../../../../db/app");
const { MergeRequestService } = await import("./mergeRequestService");

const now = () => new Date().toISOString();

describe("MergeRequestService.resetGateReview", () => {
  it("skips running nodes and missing keys", () => {
    const flowId = "flw_reset";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      "task_r", "generic", "TST-R", "reset test", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId, "task_r", "reset", "active", now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "n_gate", flowId, "ci_gate", "pipeline", "running", now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "n_review", flowId, "ai_review", "review", "done", now(), now(),
    );
    const svc = new MergeRequestService();
    svc.resetGateReview(flowId, "ci_gate", "ai_review");
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, "n_gate")?.status).toBe("running");
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, "n_review")?.status).toBe("pending");
    svc.resetGateReview(flowId, "missing_gate", null);
  });
});
