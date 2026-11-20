/**
 * BuildPromptAssembler — the ONE prompt assembly path carved out of the
 * build def (§T6/§12), shared by `run` and `previewPrompt` (CR-004: the
 * preview cannot drift from the sent prompt). The full run-vs-preview parity
 * is asserted end-to-end in `buildPromptParity.test.ts`; this file covers
 * the assembler's own contract: worktree/local wording, the branch-scope
 * prefix, the fenced untrusted plan block, the checklist block advertising
 * `claim_checklist_progress` (step 08), and the two override routes.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../../db/app");

beforeAll(resetTestDatabase);
// the registry singleton first — entering the prompts → registry → build
// cluster from the build defs' side leaves the registry mid-eval when the
// def imports the prompt library (the cycle pre-exists; see
// buildRunSupport.test.ts)
const { nodeRegistry } = await import("../../registry");
void nodeRegistry; // loaded for its eval-order side effect only (see note above)
const { BuildPromptAssembler } = await import("./buildPromptAssembler");
const { BuildRunSupport } = await import("./buildRunSupport");
const { planSteps } = await import("../../../runtime/planStepStore");
import type { FlowCtx } from "../../shared/nodeSharedExports";
import { flowCtxHelper } from "../../shared/runContext";

const now = () => new Date().toISOString();

async function seed(index: number, stepIds: string[]): Promise<{ flowId: string; ctx: FlowCtx }> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "assembler test", "open", "story", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, `assembler ${index}`, "active", "local", null, now(), now(),
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, "build", "build", "pending", now(), now(),
  );
  const artId = `art_plan_${index}`;
  await db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    artId, nodeId, flowId, "plan", 1, "# Plan", null, "draft", now(),
  );
  await planSteps.syncFromPlan(flowId, artId, stepIds.map((id, i) => ({ id, title: `Step ${i + 1}`, branch: null })));
  const ctx = {
    flow: { id: flowId, taskId, name: `assembler ${index}`, status: "active", executionMode: "local", mrBranch: null, parentFlowId: null, createdAt: now(), updatedAt: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, ctx };
}

const assembler = () => new BuildPromptAssembler(new BuildRunSupport(), flowCtxHelper);

describe("BuildPromptAssembler — the one assembly path", () => {
  it("renders worktree instructions, the branch name, the plan and the checklist with the claim_checklist_progress advisory", async () => {
    const s = await seed(71, ["s1"]);
    const { configBody, assembly } = await assembler().assemble(s.ctx, {}, {
      plan: "# The approved plan",
      branchInfo: null,
      promptOverride: null,
      setupNote: null,
    });
    expect(configBody).toBeNull();
    expect(assembly.final).toContain("already checked out on branch");
    expect(assembly.final).toContain("feature/tst-71-flw_71");
    expect(assembly.final).toContain("# The approved plan");
    expect(assembly.final).toContain("## Plan checklist");
    expect(assembly.final).toContain("[s1]");
    expect(assembly.final).toContain("claim_checklist_progress");
  });

  it("prefixes the branch scope and fences the plan as untrusted data", async () => {
    const s = await seed(72, []);
    const { assembly } = await assembler().assemble(s.ctx, {}, {
      plan: "# Scoped plan",
      branchInfo: { name: "br-x", title: "X", scope: "src/auth" },
      promptOverride: null,
      setupNote: null,
    });
    expect(assembly.final).toContain("Branch scope: src/auth");
    expect(assembly.final).toContain("# Scoped plan");
  });

  it("a missing plan renders the explicit placeholder, never an empty body", async () => {
    const s = await seed(73, []);
    const { assembly } = await assembler().assemble(s.ctx, {}, {
      plan: null,
      branchInfo: null,
      promptOverride: null,
      setupNote: null,
    });
    expect(assembly.final).toContain("(no plan yet)");
  });

  it("the chat first turn resolves the message as the FULL edited body (promptIsBody)", async () => {
    const s = await seed(74, []);
    const { configBody, assembly } = await assembler().assemble(s.ctx, {}, {
      plan: "# plan",
      branchInfo: null,
      promptOverride: "My edited body",
      promptIsBody: true,
      setupNote: null,
    });
    expect(configBody).toBe("My edited body");
    expect(assembly.body).toBe("My edited body");
    expect(assembly.final).toContain("My edited body");
  });

  it("a plain prompt override resolves around the template and reports the trimmed body", async () => {
    const s = await seed(75, []);
    const { configBody, assembly } = await assembler().assemble(s.ctx, {}, {
      plan: "# plan",
      branchInfo: null,
      promptOverride: "  extra guidance  ",
      promptIsBody: false,
      setupNote: null,
    });
    expect(configBody).toBe("  extra guidance  ");
    expect(assembly.body).toBe("extra guidance");
    expect(assembly.blocks).toEqual([]);
    expect(assembly.final).toContain("extra guidance");
  });
});
