/**
 * Plan fan-out runtime guards (Task 19): rollup idempotency helpers, skip/approve
 * promise handling, work-node addressing, hidden auto-wrap hooks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-step-flow-")),
  "test.db",
);

const { db } = await import("../../../db/app");
const { flowEngine } = await import("../../flowEngine");
const { stepFlows } = await import("./stepFlowManager");
const { hookStore } = await import("../hookStore");
const { NODE_KEYS } = await import("../../constants/nodeKeys");

const now = () => new Date().toISOString();

describe("StepFlowManager (Task 19)", () => {
  it("childWorkNodeKey prefers the expand-time payload over other nodes on the child flow", () => {
    const taskId = "task_work_node_key";
    const parentId = "flw_parent_wk";
    const childId = "flw_child_wk";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "generic", "WK-1", "work node key", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      parentId, taskId, "parent", "active", null, "sdlc", null, now(), now(),
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      childId, taskId, "child", "active", parentId, "step",
      JSON.stringify({
        plan: { title: "p", summary: "s" },
        step: { id: "s1", title: "Step", detail: null, files: [] },
        siblings: [],
        parentNodeKey: NODE_KEYS.BUILD,
        workNodeKey: "worker",
      }),
      now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_decoy", childId, "decoy", NODE_KEYS.PLAN, "pending", now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_worker", childId, "worker", NODE_KEYS.BUILD, "pending", now(), now(),
    );

    expect(stepFlows.childWorkNodeKey(childId)).toBe("worker");
  });

  it("approveChildStep rejects a second approve while merge-back is underway (CR-057)", () => {
    const taskId = "task_double_approve";
    const parentId = "flw_parent_da";
    const childId = "flw_child_da";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "generic", "DA-1", "double approve", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, mr_branch, trigger_payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      parentId, taskId, "parent", "active", null, "sdlc", null,
      null, now(), now(),
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, mr_branch, trigger_payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      childId, taskId, "child", "active", parentId, "step", "feature/x-s1",
      JSON.stringify({
        plan: { title: "p", summary: "s" },
        step: { id: "s1", title: "Step", detail: null, files: [] },
        siblings: [],
        parentNodeKey: NODE_KEYS.BUILD,
        workNodeKey: NODE_KEYS.BUILD,
      }),
      now(), now(),
    );
    db.run(
      `INSERT INTO plan_steps (id, flow_id, title, status, position, completed_by, sub_flow_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      "ps_da", parentId, "Step", "pending", 0, "merge", childId, now(), now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_da", childId, NODE_KEYS.BUILD, NODE_KEYS.BUILD, "awaiting_approval", now(), now(),
    );

    expect(() => stepFlows.approveChildStep(childId)).toThrow(/merge is already in progress/);
  });

  it("skipStepFlow rejects when the plan step is no longer pending (CR-010)", async () => {
    const taskId = "task_skip_async";
    const flowId = "flw_skip_async";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId, "generic", "SK-1", "skip async", "open", "task", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId, taskId, "parent", "active", now(), now(),
    );
    db.run(
      `INSERT INTO plan_steps (id, flow_id, title, status, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "ps_skip", flowId, "Step", "done", 0, now(), now(),
    );

    await expect(flowEngine.skipFanoutStep(flowId, "ps_skip")).rejects.toThrow(/already done/);
  });

  it("does not provision inbound hooks for hidden auto-wrap templates (CR-064)", () => {
    const tplId = db.uid("tpl_");
    const ts = db.now();
    db.run(
      `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,hidden,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      tplId, "Hidden child", "fanout-autowrap:tpl_src:build:deadbeef", 1, 0,
      JSON.stringify({ type: "manual" }), 1, ts, ts,
    );
    hookStore.syncTemplate(tplId);
    expect(hookStore.hookForTemplate(tplId)).toBeUndefined();
  });
});
