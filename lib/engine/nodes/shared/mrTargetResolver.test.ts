/**
 * Multi-branch correctness: MR target resolution and comment scoping.
 */
import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");

beforeAll(resetTestDatabase);
const { branchStore } = await import("../kinds/build/branchStore");
const { MrTargetResolver } = await import('./mrTargetResolver');
const { NodeSupport } = await import('./nodeSupport');
const { engineParts } = await import('@/lib/composition/container');

const now = () => new Date().toISOString();

const seed = async () => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    "task_1", "generic", "TST-1", "mr target", "open", "story", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    "flw_1", "task_1", "test", "active", "cloud", now(), now(),
  );
  await branchStore.upsert("flw_1", "backend", {
    title: "Backend",
    mrIid: 42,
    gitBranch: "custom/pattern-backend",
  });
  await db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    "c1", "flw_1", 42, "d1", "dev", "fix backend", null, null, "open", now(), now(),
  );
  await db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    "c2", "flw_1", 99, "d2", "dev", "other mr", null, null, "open", now(), now(),
  );
  return {
    ctx: {
      flow: { id: "flw_1", taskId: "task_1", mrIid: null, mrBranch: null },
      task: { key: "TST-1", issueType: "story" },
    },
  } as never;
};

describe("MrTargetResolver", () => {
  it("uses persisted git_branch instead of built-in naming", async () => {
    const { ctx } = await seed();
    const resolver = new MrTargetResolver(new NodeSupport(engineParts.transitions));
    const target = await resolver.resolve(ctx, "backend");
    expect(target.mrIid).toBe(42);
    expect(target.mrBranch).toBe("custom/pattern-backend");
  });

  it("openComments filters by mr_iid", async () => {
    const support = new NodeSupport(engineParts.transitions);
    const flowId = "flw_2";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_2", "generic", "TST-2", "comments", "open", "story", "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      flowId, "task_2", "test2", "active", "cloud", now(), now(),
    );
    await db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      "c1b", flowId, 42, "d1", "dev", "fix backend", null, null, "open", now(), now(),
    );
    await db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      "c2b", flowId, 99, "d2", "dev", "other mr", null, null, "open", now(), now(),
    );
    expect(await support.openComments(flowId, 42)).toHaveLength(1);
    expect(await support.openComments(flowId, 99)).toHaveLength(1);
    expect(await support.openComments(flowId)).toHaveLength(2);
  });
});
