import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../../db/app");

beforeAll(resetTestDatabase);
const { branchStore } = await import("./branchStore");

const now = () => new Date().toISOString();

describe("BranchStore.tagRun", () => {
  it("sets branch_id on a closed run row by primary key", async () => {
    const taskId = "task_branch_tag";
    const flowId = "flw_branch_tag";
    const nodeId = "node_branch_tag";
    const runRowId = db.uid("run_");
    const branchRowId = db.uid("br_");
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId,
      "generic",
      "BR-1",
      "branch tag test",
      "open",
      "story",
      "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId,
      taskId,
      "branch tag test",
      "active",
      now(),
      now(),
    );
    await db.run(
      `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      branchRowId,
      flowId,
      "feature-a",
      "Feature A",
      "building",
      now(),
      now(),
    );
    await db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      nodeId,
      flowId,
      "build",
      "build",
      "running",
      now(),
      now(),
    );
    await db.run(
      `INSERT INTO runs (id, flow_id, node_id, agent_ref, run_ref, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      runRowId,
      flowId,
      nodeId,
      "agt_test",
      "run_ref_test",
      "finished",
      now(),
      now(),
    );

    await branchStore.tagRun(runRowId, branchRowId);

    const tagged = await db.get<{ branch_id: string | null }>(`SELECT branch_id FROM runs WHERE id=$1`, runRowId);
    expect(tagged?.branch_id).toBe(branchRowId);
  });
});
