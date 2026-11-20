/**
 * PromptPreview.allFor (the plan composer's bulk prompt read): one response
 * carries every promptable node's editable body keyed by node key — the same
 * live resolution one node's preview does (§4a). Nodes whose def declines a
 * preview (defs without a prompt surface) are skipped, matching the
 * single-node route.
 *
 * Runs against the dockerized Postgres test DB (vitest globalSetup migrates
 * it; `resetTestDatabase` truncates + re-seeds per file — AGENTS.md §1 —
 * never a real database).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);

const { promptPreview } = await import("./promptPreview");
const { NODE_KEYS } = await import("../constants/nodeKeys");

const now = () => new Date().toISOString();

/** One isolated task + flow on the seeded SDLC template (template_id null). */
async function seedFlow(index: number): Promise<string> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "prompt bulk read", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,'active',$4,$5)`,
    flowId, taskId, `prompt bulk read ${index}`, now(), now(),
  );
  return flowId;
}

async function seedNode(flowId: string, nodeKey: string, type: string) {
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `node_${flowId}_${nodeKey}`, flowId, nodeKey, type, "pending", now(), now(),
  );
}

describe("PromptPreview.allFor — the composer's bulk prompt read", () => {
  it("every promptable node's body rides one response, keyed by node key", async () => {
    const flowId = await seedFlow(1);
    for (const nodeKey of [NODE_KEYS.PLAN, NODE_KEYS.BUILD, NODE_KEYS.RESOLVE]) {
      await seedNode(flowId, nodeKey, nodeKey);
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
    const flowId = await seedFlow(2);
    await seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);
    await seedNode(flowId, "entry_gate", "start");

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

describe("PromptPreview divergesReason — why the last run diverges (step 05)", () => {
  const setNodeInput = async (flowId: string, nodeKey: string, input: unknown): Promise<void> => {
    await testRun(
      `UPDATE nodes SET input=$1 WHERE flow_id=$2 AND node_key=$3`,
      JSON.stringify(input),
      flowId,
      nodeKey,
    );
  };

  const planPreview = async (flowId: string) => {
    const result = await promptPreview.previewFor(
      flowId,
      new URL(`http://fixture.local/?node=${encodeURIComponent(NODE_KEYS.PLAN)}`),
    );
    if (!result.ok) throw new Error("expected an ok preview");
    return result.payload;
  };

  it("only the run-data slots differ → run-data", async () => {
    const flowId = await seedFlow(20);
    await seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);
    const { final } = await planPreview(flowId);
    // the recorded run prompt = the same resolution + the live context block
    await setNodeInput(flowId, NODE_KEYS.PLAN, { prompt: `${final}\n\nCONTEXT-PACK-DATA` });

    const payload = await planPreview(flowId);
    expect(payload.diverges).toBe(true);
    expect(payload.divergesReason).toBe("run-data");
  });

  it("a template section moved → template-edited", async () => {
    const flowId = await seedFlow(21);
    await seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);
    await setNodeInput(flowId, NODE_KEYS.PLAN, { prompt: "an old prompt from before the template edit" });

    const payload = await planPreview(flowId);
    expect(payload.diverges).toBe(true);
    expect(payload.divergesReason).toBe("template-edited");
  });

  it("identical → no divergence, no reason", async () => {
    const flowId = await seedFlow(22);
    await seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);
    const { final } = await planPreview(flowId);
    await setNodeInput(flowId, NODE_KEYS.PLAN, { prompt: final });

    const payload = await planPreview(flowId);
    expect(payload.diverges).toBe(false);
    expect(payload.divergesReason).toBeUndefined();
  });
});

describe("PromptPreview.previewFor — branch-scoped plan (CR-049)", () => {
  it("the pipeline node preview assembles the fix-run body", async () => {
    const flowId = await seedFlow(10);
    await seedNode(flowId, NODE_KEYS.PIPELINE, NODE_KEYS.PIPELINE);

    const result = await promptPreview.previewFor(
      flowId,
      new URL(`http://fixture.local/?node=${encodeURIComponent(NODE_KEYS.PIPELINE)}`),
    );
    if (!result.ok) throw new Error("expected an ok preview");
    expect(result.payload.label).toBe("Pipeline fix");
    expect(result.payload.engineRules).toContain("Fix the failures by committing and pushing fixes to the SAME branch");
  });

  it("unknown plan branch → 400 via previewPrompt on the plan def", async () => {
    const flowId = await seedFlow(11);
    await seedNode(flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN);

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
