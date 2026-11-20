/**
 * MergeBackCoordinator (step 07 fan-out decomposition): the approve →
 * merge-back loop's claim guards — one merge in flight per child, claimed
 * atomically; non-children reject loud.
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import type { MergeBackCoordinator } from "./mergeBackCoordinator";

const { resetTestDatabase } = await import("../../../../tests/helpers/testDatabase");
const { stepFlows } = await import("./stepFlowManager");
const { NODE_KEYS } = await import("../../constants/nodeKeys");

const now = () => new Date().toISOString();

beforeAll(resetTestDatabase);

/** the facade composes the coordinator (private member — test seam) */
const mergeBack = (stepFlows as unknown as { mergeBack: MergeBackCoordinator }).mergeBack;

describe("MergeBackCoordinator", () => {
  it("approveChildStep rejects a second approve while merge-back is underway (CR-057)", async () => {
    const taskId = "task_double_approve";
    const parentId = "flw_parent_da";
    const childId = "flw_child_da";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "DA-1", "double approve", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, mr_branch, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      parentId, taskId, "parent", "active", null, "sdlc", null,
      null, now(), now(),
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, mr_branch, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
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
    await testRun(
      `INSERT INTO plan_steps (id, flow_id, title, status, position, completed_by, sub_flow_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      "ps_da", parentId, "Step", "pending", 0, "merge", childId, now(), now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "node_da", childId, NODE_KEYS.BUILD, NODE_KEYS.BUILD, "awaiting_approval", now(), now(),
    );

    await expect(mergeBack.approveChildStep(childId)).rejects.toThrow(/merge is already in progress/);
  });

  it("approveChildStep rejects a flow that is not a fan-out step child", async () => {
    const taskId = "task_not_child";
    const flowId = "flw_not_child";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "NC-1", "not a child", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, taskId, "parent", "active", now(), now(),
    );

    await expect(mergeBack.approveChildStep(flowId)).rejects.toThrow(/not a fan-out step child/);
  });
});
