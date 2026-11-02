/**
 * Wait-timer re-arm after restart (CR-006 minimum fix).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-wait-rearm-")),
  "test.db",
);

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine");
const { templateStore } = await import("./templates/templateStore");

const now = () => new Date().toISOString();

describe("reArmWaitingTimers", () => {
  const engine = new FlowEngine();

  it("re-arms a waiting debounced resolve from updated_at + quiet minutes", () => {
    const taskId = "task_rearm";
    const flowId = "flw_rearm";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "generic", "TST-R", "rearm", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId, taskId, "rearm", "active", now(), now(),
    );
    const resolve = templateStore.graphForFlow(flowId)?.nodes.find(
      (n: { trigger: { type: string; wait_for?: string }; key: string }) =>
        n.trigger.type === "debounced" && n.trigger.wait_for === "comments",
    );
    if (!resolve) throw new Error("expected debounced resolve node");
    const updatedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, label, config, join_mode, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "node_rearm", flowId, resolve.key, "resolve", "Resolve", "{}", "all", "waiting", updatedAt, updatedAt,
    );
    expect(engine.resolveScheduleAt(flowId)).toBeNull();
    engine.reArmWaitingTimers();
    const at = engine.resolveScheduleAt(flowId);
    expect(at).not.toBeNull();
    if (at == null) throw new Error("expected re-armed deadline");
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
