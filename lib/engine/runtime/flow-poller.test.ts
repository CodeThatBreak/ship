/**
 * Flow poller: pipeline status is tracked per plan branch, not flow-wide.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-flow-poller-")),
  "test.db",
);

const { db } = await import("../../db");

const now = () => new Date().toISOString();

const previousPipelineStatus = (flowId: string, branchName?: string): string | null => {
  const prev = branchName
    ? db.get<{ data: string }>(
        `SELECT data FROM events WHERE flow_id=? AND type='pipeline' AND json_extract(data,'$.branchName')=? ORDER BY created_at DESC LIMIT 1`,
        flowId,
        branchName,
      )
    : db.get<{ data: string }>(
        `SELECT data FROM events WHERE flow_id=? AND type='pipeline' AND (json_extract(data,'$.branchName') IS NULL OR json_extract(data,'$.branchName')='') ORDER BY created_at DESC LIMIT 1`,
        flowId,
      );
  return prev?.data ? (JSON.parse(prev.data) as { status: string }).status : null;
};

describe("pipeline poll state per branch", () => {
  it("reads the latest pipeline event scoped to branchName", () => {
    const flowId = "flw_poll";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      "task_p", "generic", "TST-P", "poll", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId, "task_p", "poll", "active", now(), now(),
    );
    db.emitEvent(flowId, null, "pipeline", "a failed", { status: "failed", branchName: "a" });
    db.emitEvent(flowId, null, "pipeline", "b success", { status: "success", branchName: "b" });
    expect(previousPipelineStatus(flowId, "a")).toBe("failed");
    expect(previousPipelineStatus(flowId, "b")).toBe("success");
    expect(previousPipelineStatus(flowId, "a")).not.toBe("success");
  });
});
