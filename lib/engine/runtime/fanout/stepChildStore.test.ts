/**
 * StepChildStore (step 07 fan-out decomposition): the shared child-row data
 * access — work-node addressing and trigger-payload reads.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { StepChildStore } from "./stepChildStore";

const { db } = await import("../../../db/app");
const { resetTestDatabase } = await import("../../../../tests/helpers/testDatabase");
const { stepFlows } = await import("./stepFlowManager");
const { NODE_KEYS } = await import("../../constants/nodeKeys");

const now = () => new Date().toISOString();

beforeAll(resetTestDatabase);

/** the facade composes the store (private member — test seam) */
const store = (stepFlows as unknown as { children: StepChildStore }).children;

describe("StepChildStore", () => {
  it("childWorkNodeKey prefers the expand-time payload over other nodes on the child flow", async () => {
    const taskId = "task_work_node_key";
    const parentId = "flw_parent_wk";
    const childId = "flw_child_wk";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "WK-1", "work node key", "open", "task", "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      parentId, taskId, "parent", "active", null, "sdlc", null, now(), now(),
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
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
    await db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "node_decoy", childId, "decoy", NODE_KEYS.PLAN, "pending", now(), now(),
    );
    await db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "node_worker", childId, "worker", NODE_KEYS.BUILD, "pending", now(), now(),
    );

    expect(await store.childWorkNodeKey(childId)).toBe("worker");
    expect(await store.childTypeOf(childId)).toBe(NODE_KEYS.BUILD);
  });

  it("childPayload parses the persisted trigger payload and rejects one without fan-out linkage", async () => {
    const taskId = "task_child_payload";
    const parentId = "flw_payload_parent";
    const withPayload = "flw_payload_yes";
    const withoutPayload = "flw_payload_no";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "CP-1", "child payload", "open", "task", "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      parentId, taskId, "parent", "active", now(), now(),
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      withPayload, taskId, "child", "active", parentId, "step",
      JSON.stringify({
        plan: { title: "p", summary: "s" },
        step: { id: "s1", title: "Step", detail: null, files: ["a.ts"] },
        siblings: [],
        parentNodeKey: NODE_KEYS.BUILD,
      }),
      now(), now(),
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, kind, trigger_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      withoutPayload, taskId, "child", "active", "step", JSON.stringify({ unrelated: true }), now(), now(),
    );

    expect(await store.childPayload(withPayload)).toMatchObject({ parentNodeKey: NODE_KEYS.BUILD });
    expect(await store.childPayload(withoutPayload)).toBeNull(); // no parentNodeKey — no linkage
    expect(await store.childPayload("flw_missing_row")).toBeNull();
  });
});
