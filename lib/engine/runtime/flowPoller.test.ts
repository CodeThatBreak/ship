/**
 * Flow poller: pipeline status is tracked per plan branch, not flow-wide.
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { describe, expect, it } from "vitest";

const { db } = await import("../../db/app");

const now = () => new Date().toISOString();

const previousPipelineStatus = async (flowId: string, branchName?: string): Promise<string | null> => {
  const prev = branchName
    ? await testGet<{ data: unknown }>(
        `SELECT data FROM events WHERE flow_id=$1 AND type='pipeline' AND data->>'branchName'=$2 ORDER BY created_at DESC LIMIT 1`,
        flowId,
        branchName,
      )
    : await testGet<{ data: unknown }>(
        `SELECT data FROM events WHERE flow_id=$1 AND type='pipeline' AND (data->>'branchName' IS NULL OR data->>'branchName'='') ORDER BY created_at DESC LIMIT 1`,
        flowId,
      );
  if (!prev || !prev.data || typeof prev.data !== "object") return null;
  const parsed = prev.data as { status?: unknown };
  return typeof parsed.status === "string" ? parsed.status : null;
};

describe("pipeline poll state per branch", () => {
  it("reads the latest pipeline event scoped to branchName", async () => {
    const flowId = "flw_poll";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_p", "generic", "TST-P", "poll", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, "task_p", "poll", "active", now(), now(),
    );
    await db.emitEvent(flowId, null, "pipeline", "a failed", { status: "failed", branchName: "a" });
    await db.emitEvent(flowId, null, "pipeline", "b success", { status: "success", branchName: "b" });
    expect(await previousPipelineStatus(flowId, "a")).toBe("failed");
    expect(await previousPipelineStatus(flowId, "b")).toBe("success");
    expect(await previousPipelineStatus(flowId, "a")).not.toBe("success");
  });
});
