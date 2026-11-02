/**
 * Multi-branch correctness: MR target resolution and comment scoping.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-mr-target-")),
  "test.db",
);

const { db } = await import("../../../db/app");
const { branchStore } = await import("../kinds/build/branchStore");
const { MrTargetResolver } = await import('./mrTargetResolver');
const { NodeSupport } = await import('./nodeSupport');

const now = () => new Date().toISOString();

const seed = () => {
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    "task_1", "generic", "TST-1", "mr target", "open", "story", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    "flw_1", "task_1", "test", "active", "cloud", now(), now(),
  );
  branchStore.upsert("flw_1", "backend", {
    title: "Backend",
    mrIid: 42,
    gitBranch: "custom/pattern-backend",
  });
  db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    "c1", "flw_1", 42, "d1", "dev", "fix backend", null, null, "open", now(), now(),
  );
  db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    "c2", "flw_1", 99, "d2", "dev", "other mr", null, null, "open", now(), now(),
  );
  return {
    ctx: {
      flow: { id: "flw_1", task_id: "task_1", mr_iid: null, mr_branch: null },
      task: { key: "TST-1", issueType: "story" },
    },
  } as never;
};

describe("MrTargetResolver", () => {
  it("uses persisted git_branch instead of built-in naming", () => {
    const { ctx } = seed();
    const resolver = new MrTargetResolver(new NodeSupport());
    const target = resolver.resolve(ctx, "backend");
    expect(target.mrIid).toBe(42);
    expect(target.mrBranch).toBe("custom/pattern-backend");
  });

  it("openComments filters by mr_iid", () => {
    const support = new NodeSupport();
    const flowId = "flw_2";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      "task_2", "generic", "TST-2", "comments", "open", "story", "P2",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      flowId, "task_2", "test2", "active", "cloud", now(), now(),
    );
    db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      "c1b", flowId, 42, "d1", "dev", "fix backend", null, null, "open", now(), now(),
    );
    db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      "c2b", flowId, 99, "d2", "dev", "other mr", null, null, "open", now(), now(),
    );
    expect(support.openComments(flowId, 42)).toHaveLength(1);
    expect(support.openComments(flowId, 99)).toHaveLength(1);
    expect(support.openComments(flowId)).toHaveLength(2);
  });
});
