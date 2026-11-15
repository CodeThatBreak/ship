/**
 * CR-004: build `previewPrompt` must share branch/instructions/checklist
 * assembly with `run` (local-mode worktree wording, branchName not mr_branch).
 */
import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../../db/app");

beforeAll(resetTestDatabase);
const { nodeRegistry } = await import("../../registry");
const { nodeRoles } = await import("../../shared/nodeRoles");
const { NODE_KEYS } = await import("../../../constants/nodeKeys");
const { BuildRunSupport } = await import("./buildRunSupport");
const { planSteps } = await import("../../../runtime/planStepStore");
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeRow } from "../../../../db/rows";

const now = () => new Date().toISOString();

const seedLocalFlow = async (index: number, mrBranch: string | null): Promise<{ ctx: FlowCtx; node: NodeRow }> => {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "build prompt parity", "open", "story", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, `parity ${index}`, "active", "local", mrBranch, now(), now(),
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, NODE_KEYS.BUILD, NODE_KEYS.BUILD, "pending", now(), now(),
  );
  await db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    `art_plan_${index}`, nodeId, flowId, "plan", 1, "# Plan\n\nDo the thing.", null, "draft", now(),
  );
  await planSteps.syncFromPlan(flowId, `art_plan_${index}`, [
    { id: "s1", title: "Step one", branch: null },
  ]);

  const ctx = {
    flow: {
      id: flowId,
      taskId,
      name: `parity ${index}`,
      status: "active",
      executionMode: "local",
      mrBranch,
      parentFlowId: null,
      createdAt: now(),
      updatedAt: now(),
    },
    task: {
      id: taskId,
      type: "generic",
      key: `TST-${index}`,
      summary: "build prompt parity",
      fields: {},
      status: "open",
      issueType: "story",
      priority: "P2",
    },
    repo: { defaultBranch: "main", localPath: "/tmp/fixture-hub" },
  } as unknown as FlowCtx;

  const node = {
    id: nodeId,
    flowId,
    nodeKey: NODE_KEYS.BUILD,
    type: NODE_KEYS.BUILD,
    status: "pending",
    config: null,
    input: null,
    createdAt: now(),
    updatedAt: now(),
  } as unknown as NodeRow;

  return { ctx, node };
};

describe("BuildNode previewPrompt parity (CR-004)", () => {
  const buildDef = nodeRegistry.get(NODE_KEYS.BUILD);
  const previewBuild = () => {
    const previewer = nodeRoles.promptPreviewerOf(buildDef);
    if (!previewer) throw new Error("build def must preview");
    return previewer;
  };

  it("uses worktree instructions and branchName, not stale mr_branch or checkout wording", async () => {
    const { ctx, node } = await seedLocalFlow(1, "stale/wrong-branch");
    const preview = await previewBuild().previewPrompt(ctx, node, {});
    if (!preview) throw new Error("expected a build preview");

    const final = preview.assembly.final;
    expect(final).toContain("already checked out on branch");
    expect(final).not.toContain("First create and check out");

    const expectedBranch = new BuildRunSupport().branchName(ctx, {}, undefined);
    expect(final).toContain(`"${expectedBranch}"`);
    expect(final).not.toContain("stale/wrong-branch");
    expect(final).toContain("Plan checklist");
    expect(final).toContain("[s1]");
  });
});
