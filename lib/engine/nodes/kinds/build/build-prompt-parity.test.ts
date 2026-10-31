/**
 * CR-004: build `previewPrompt` must share branch/instructions/checklist
 * assembly with `run` (local-mode worktree wording, branchName not mr_branch).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-build-prompt-parity-")),
  "test.db",
);

const { db } = await import("../../../../db");
const { nodeRegistry } = await import("../../registry");
const { nodeRoles } = await import("../../shared/node-roles");
const { NODE_KEYS } = await import("../../../constants/node-keys");
const { BuildRunSupport } = await import("./build-run-support");
const { planSteps } = await import("../../../runtime/plan-step-store");
import type { FlowCtx } from "../../shared";
import type { NodeRow } from "../../../../db/rows";

const now = () => new Date().toISOString();

const seedLocalFlow = (index: number, mrBranch: string | null): { ctx: FlowCtx; node: NodeRow } => {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${index}`, "build prompt parity", "open", "story", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    flowId, taskId, `parity ${index}`, "active", "local", mrBranch, now(), now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    nodeId, flowId, NODE_KEYS.BUILD, NODE_KEYS.BUILD, "pending", now(), now(),
  );
  db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    `art_plan_${index}`, nodeId, flowId, "plan", 1, "# Plan\n\nDo the thing.", null, "active", now(),
  );
  planSteps.syncFromPlan(flowId, `art_plan_${index}`, [
    { id: "s1", title: "Step one", branch: null },
  ]);

  const ctx = {
    flow: {
      id: flowId,
      task_id: taskId,
      name: `parity ${index}`,
      status: "active",
      execution_mode: "local",
      mr_branch: mrBranch,
      parent_flow_id: null,
      created_at: now(),
      updated_at: now(),
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
    repo: { default_branch: "main", local_path: "/tmp/fixture-hub" },
  } as unknown as FlowCtx;

  const node = {
    id: nodeId,
    flow_id: flowId,
    node_key: NODE_KEYS.BUILD,
    type: NODE_KEYS.BUILD,
    status: "pending",
    config: null,
    input: null,
    created_at: now(),
    updated_at: now(),
  } as NodeRow;

  return { ctx, node };
};

describe("BuildNode previewPrompt parity (CR-004)", () => {
  const buildDef = nodeRegistry.get(NODE_KEYS.BUILD);
  const previewBuild = () => {
    const previewer = nodeRoles.promptPreviewerOf(buildDef);
    if (!previewer) throw new Error("build def must preview");
    return previewer;
  };

  it("uses worktree instructions and branchName, not stale mr_branch or checkout wording", () => {
    const { ctx, node } = seedLocalFlow(1, "stale/wrong-branch");
    const preview = previewBuild().previewPrompt(ctx, node, {});
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
