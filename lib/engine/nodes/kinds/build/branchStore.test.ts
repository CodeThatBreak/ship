import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-branch-store-")),
  "test.db",
);

const { db } = await import("../../../../db/app");
const { branchStore } = await import("./branchStore");

const now = () => new Date().toISOString();

describe("BranchStore.tagRun", () => {
  it("sets branch_id on a closed run row by primary key", () => {
    const taskId = "task_branch_tag";
    const flowId = "flw_branch_tag";
    const nodeId = "node_branch_tag";
    const runRowId = db.uid("run_");
    const branchRowId = db.uid("br_");
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId,
      "generic",
      "BR-1",
      "branch tag test",
      "open",
      "story",
      "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      flowId,
      taskId,
      "branch tag test",
      "active",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      branchRowId,
      flowId,
      "feature-a",
      "Feature A",
      "building",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      nodeId,
      flowId,
      "build",
      "build",
      "running",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO runs (id, flow_id, node_id, agent_ref, run_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      runRowId,
      flowId,
      nodeId,
      "agt_test",
      "run_ref_test",
      "finished",
      now(),
      now(),
    );

    branchStore.tagRun(runRowId, branchRowId);

    const tagged = db.get<{ branch_id: string | null }>(`SELECT branch_id FROM runs WHERE id=?`, runRowId);
    expect(tagged?.branch_id).toBe(branchRowId);
  });
});
