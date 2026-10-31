/**
 * PromptPreview.allFor (the plan composer's bulk prompt read): one response
 * carries every promptable node's editable body keyed by node key — the same
 * live resolution one node's preview does (§4a). Nodes whose def declines a
 * preview (defs without a prompt surface) are skipped, matching the
 * single-node route.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-prompt-bulk-")),
  "test.db",
);

const { db } = await import("../../db/app");
const { promptPreview } = await import("./promptPreview");
const { NODE_KEYS } = await import("../constants/nodeKeys");

const now = () => new Date().toISOString();

/** One isolated task + flow on the seeded SDLC template (template_id null). */
function seedFlow(index: number): string {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${index}`, "prompt bulk read", "open", "task", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId, taskId, `prompt bulk read ${index}`, "active", now(), now(),
  );
  return flowId;
}

function seedNode(flowId: string, nodeKey: string, type: string) {
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    `node_${flowId}_${nodeKey}`, flowId, nodeKey, type, "pending", now(), now(),
  );
}

describe("PromptPreview.allFor — the composer's bulk prompt read", () => {
  it("every promptable node's body rides one response, keyed by node key", async () => {
    const flowId = seedFlow(1);
    for (const nodeKey of [NODE_KEYS.PLAN, NODE_KEYS.BUILD, NODE_KEYS.RESOLVE]) {
      seedNode(flowId, nodeKey, nodeKey);
    }

    const result = await promptPreview.allFor(flowId);
    if (!result.ok) throw new Error("expected an ok bulk read");

    expect(Object.keys(result.prompts).sort()).toEqual(
      [NODE_KEYS.PLAN, NODE_KEYS.BUILD, NODE_KEYS.RESOLVE].sort(),
    );
    // bodies are the same live resolution the single-node preview does — the
    // template defaults here; agent-driven nodes (resolve) may carry an
    // empty body (their prompt surfaces live in the other sections)
    expect(result.prompts[NODE_KEYS.PLAN].length).toBeGreaterThan(0);
    expect(result.prompts[NODE_KEYS.BUILD].length).toBeGreaterThan(0);
    expect(typeof result.prompts[NODE_KEYS.RESOLVE]).toBe("string");
  });

  it("nodes whose def declines a preview are skipped (the start def has no prompt surface)", async () => {
    const flowId = seedFlow(2);
    seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);
    seedNode(flowId, "entry_gate", "start");

    const result = await promptPreview.allFor(flowId);
    if (!result.ok) throw new Error("expected an ok bulk read");
    expect(Object.keys(result.prompts)).toEqual([NODE_KEYS.PLAN]);
  });

  it("an unknown flow → 404 (the route maps it)", async () => {
    const result = await promptPreview.allFor("flw_missing");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the failure member");
    expect(result.status).toBe(404);
    expect(result.error).toBe("flow not found");
  });
});

describe("PromptPreview.previewFor — branch-scoped plan and rulesKey (CR-049)", () => {
  it("returns fix_prompt_rules for the pipeline node preview", async () => {
    const flowId = seedFlow(10);
    seedNode(flowId, NODE_KEYS.PIPELINE, NODE_KEYS.PIPELINE);

    const result = await promptPreview.previewFor(
      flowId,
      new URL(`http://fixture.local/?node=${encodeURIComponent(NODE_KEYS.PIPELINE)}`),
    );
    if (!result.ok) throw new Error("expected an ok preview");
    expect(result.payload.rulesKey).toBe("fix_prompt_rules");
  });

  it("unknown plan branch → 400 via previewPrompt on the plan def", async () => {
    const flowId = seedFlow(11);
    seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);

    const result = await promptPreview.previewFor(
      flowId,
      new URL(`http://fixture.local/?node=${encodeURIComponent(NODE_KEYS.PLAN)}&branch=missing-branch`),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the failure member");
    expect(result.status).toBe(400);
    expect(result.error).toContain("missing-branch");
  });
});
