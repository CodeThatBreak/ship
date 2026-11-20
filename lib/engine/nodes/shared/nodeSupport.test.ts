/**
 * NodeSupport artifact queries — ordering must match "newest first" so
 * `latestArtifact` and plan/build consumers see the approved version.
 *
 * Isolated temp SQLite DB (AGENTS.md §1).
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";


import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();


beforeAll(resetTestDatabase);
const { NodeSupport } = await import("./nodeSupport");
const { engineParts } = await import("@/lib/composition/container");
const { ConflictError, ValidationError } = await import("../../../errors");

const now = () => new Date().toISOString();

const seedPlanNode = async (flowId: string): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    `TST-${flowId}`,
    "node-support test",
    "open",
    "task",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId,
    taskId,
    "node-support test",
    "active",
    now(),
    now(),
  );
  const nodeId = `node_${flowId}`;
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId,
    flowId,
    "plan",
    "plan",
    "awaiting_approval",
    now(),
    now(),
  );
  return nodeId;
};

describe("NodeSupport — plan artifact ordering (CR-270)", () => {
  const support = new NodeSupport(engineParts.transitions);

  it("latestArtifact and artifactsOfKind return newest plan versions first", async () => {
    const flowId = "flw_art_order";
    const nodeId = await seedPlanNode(flowId);

    await support.saveArtifact(nodeId, flowId, "plan", "# Plan v1", { steps: [], branches: [] });
    await support.saveArtifact(nodeId, flowId, "plan", "# Plan v2", { steps: [], branches: [] });
    await support.saveArtifact(nodeId, flowId, "plan", "# Plan v3", { steps: [], branches: [] });

    const latest = await support.latestArtifact(flowId, "plan", { nodeType: "plan" });
    expect(latest?.version).toBe(3);
    expect(latest?.content).toBe("# Plan v3");

    const all = await support.artifactsOfKind(flowId, "plan", { nodeType: "plan" });
    expect(all.map((a) => a.version)).toEqual([3, 2, 1]);
  });
});

describe("NodeSupport — startup run rows", () => {
  const support = new NodeSupport(engineParts.transitions);

  it("registerStartupRun is idempotent and persistRun upgrades the placeholder", async () => {
    const flowId = "flw_startup_run";
    const nodeId = await seedPlanNode(flowId);
    await testRun(`UPDATE nodes SET status='running', attempt_id='att_test' WHERE id=$1`, nodeId);

    await support.registerStartupRun(flowId, nodeId, "att_test");
    await support.registerStartupRun(flowId, nodeId, "att_test");

    const pending = await testGet<{ agent_ref: string; run_ref: string; status: string }>(
      `SELECT agent_ref, run_ref, status FROM runs WHERE node_id=$1 AND status='running'`,
      nodeId,
    );
    expect(pending).toMatchObject({
      agent_ref: "pending",
      run_ref: "att_test",
      status: "running",
    });

    const runRowId = await support.persistRun(flowId, nodeId, "agt_real", "run_real");
    const upgraded = await testGet<{ id: string; agent_ref: string; run_ref: string }>(
      `SELECT id, agent_ref, run_ref FROM runs WHERE id=$1`,
      runRowId,
    );
    expect(upgraded).toMatchObject({ agent_ref: "agt_real", run_ref: "run_real" });
    expect(await support.lastAgentId(nodeId)).toBe("agt_real");
  });
});

describe("NodeSupport.claim (Task 17)", () => {
  const support = new NodeSupport(engineParts.transitions);

  it("stamps attempt_id and rejects a second concurrent claim", async () => {
    const flowId = "flw_claim";
    const nodeId = await seedPlanNode(flowId);
    await testRun(`UPDATE nodes SET status='pending' WHERE id=$1`, nodeId);

    const { attemptId } = await engineParts.transitions.claim(flowId, "plan", "runFromPending");
    expect(attemptId.startsWith("att_")).toBe(true);
    expect(await testGet<{ status: string; attempt_id: string }>(
      `SELECT status, attempt_id FROM nodes WHERE id=$1`,
      nodeId,
    )).toMatchObject({ status: "running", attempt_id: attemptId });

    await expect(engineParts.transitions.claim(flowId, "plan", "runFromPending")).rejects.toThrow(ConflictError);
  });

  it("applyTransition moves status only from declared sources", async () => {
    const flowId = "flw_transition";
    await seedPlanNode(flowId);
    await support.applyTransition(flowId, "plan", "approve");
    expect(await testGet<{ status: string; attempt_id: null }>(
      `SELECT status, attempt_id FROM nodes WHERE flow_id=$1 AND node_key='plan'`,
      flowId,
    )).toMatchObject({ status: "approved", attempt_id: null });
  });

  it("setNode refuses status keys — status writes belong to the authority", async () => {
    const flowId = "flw_refuse";
    const nodeId = await seedPlanNode(flowId);
    await expect(support.setNode(nodeId, { status: "done" })).rejects.toThrow(/TransitionAuthority/);
  });
});

describe("NodeSupport.setNode — JSONB text→jsonb cast parity", () => {
  const support = new NodeSupport(engineParts.transitions);

  it("parses pre-serialized JSON text for input/output/config so the column stores an object", async () => {
    const flowId = "flw_json_cast";
    const nodeId = await seedPlanNode(flowId);
    await support.setNode(nodeId, {
      input: JSON.stringify({ prompt: "hello" }),
      output: JSON.stringify({ answer: 42 }),
      config: JSON.stringify({ snapshot: true }),
    });
    const node = await support.nodeByKey(flowId, "plan");
    expect(node.input).toEqual({ prompt: "hello" });
    expect(node.output).toEqual({ answer: 42 });
    expect(node.config).toEqual({ snapshot: true });
  });

  it("throws ValidationError on invalid JSON text for a JSONB column", async () => {
    const flowId = "flw_json_bad";
    const nodeId = await seedPlanNode(flowId);
    await expect(support.setNode(nodeId, { input: "{not json" })).rejects.toThrow(ValidationError);
  });

  it("maps raw-era snake_case column keys onto Prisma field names", async () => {
    const flowId = "flw_col_names";
    const nodeId = await seedPlanNode(flowId);
    await support.setNode(nodeId, { agent_id: "agt_x" });
    expect(
      (await testGet<{ agent_id: string | null }>(`SELECT agent_id FROM nodes WHERE id=$1`, nodeId))?.agent_id,
    ).toBe("agt_x");
  });
});

describe("NodeSupport — comment queries and agent reply effects", () => {
  const support = new NodeSupport(engineParts.transitions);

  /** Seed an open comment row with an explicit timestamp (ordering control). */
  const seedOpenComment = async (
    flowId: string,
    id: string,
    overrides: { mrIid?: number; discussionId?: string; createdAt?: string } = {},
  ) => {
    await testRun(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      id,
      flowId,
      overrides.mrIid ?? null,
      overrides.discussionId ?? `d_${id}`,
      "reviewer",
      `comment ${id}`,
      null,
      null,
      "open",
      overrides.createdAt ?? now(),
      now(),
    );
  };

  it("openComments orders deterministically by created_at then id (G12)", async () => {
    const flowId = "flw_comments_order";
    await seedPlanNode(flowId);
    // insertion order shuffled against both sort keys: id ASC is the tie-break,
    // created_at ASC is primary regardless of insertion order
    await seedOpenComment(flowId, "gl_2", { createdAt: "2026-11-04T10:00:00.000Z" });
    await seedOpenComment(flowId, "gl_1", { createdAt: "2026-11-04T10:00:00.000Z" });
    await seedOpenComment(flowId, "gl_4", { createdAt: "2026-11-03T09:00:00.000Z" });
    await seedOpenComment(flowId, "gl_3", { createdAt: "2026-11-05T08:00:00.000Z" });

    expect((await support.openComments(flowId)).map((c) => c.id)).toEqual(["gl_4", "gl_1", "gl_2", "gl_3"]);
    expect((await support.openComments(flowId, 42)).map((c) => c.id)).toEqual([]);
  });

  it("resolveComments marks every given row resolved-by-agent and no-ops on empty", async () => {
    const flowId = "flw_comments_resolve";
    await seedPlanNode(flowId);
    await seedOpenComment(flowId, "gl_10", { mrIid: 7 });
    await seedOpenComment(flowId, "gl_11", { mrIid: 7 });
    await seedOpenComment(flowId, "gl_12", { mrIid: 7 });

    await support.resolveComments([]);

    await support.resolveComments(["gl_10", "gl_11"]);
    expect(
      await testAll<{ id: string; status: string; resolved_by: string }>(
        `SELECT id, status, resolved_by FROM comments WHERE flow_id=$1 ORDER BY id`,
        flowId,
      ),
    ).toEqual([
      { id: "gl_10", status: "resolved", resolved_by: "agent" },
      { id: "gl_11", status: "resolved", resolved_by: "agent" },
      { id: "gl_12", status: "open", resolved_by: null },
    ]);
    // the single-row method delegates to the same batch path
    await support.resolveComment("gl_12");
    expect(await testGet<{ status: string; resolved_by: string }>(
      `SELECT status, resolved_by FROM comments WHERE id=$1`,
      "gl_12",
    )).toEqual({ status: "resolved", resolved_by: "agent" });
  });

  it("recordAgentReply inserts the posted note closed-by-agent and skips raced ingests (G10)", async () => {
    const flowId = "flw_agent_reply";
    await seedPlanNode(flowId);

    await support.recordAgentReply({
      flowId,
      mrIid: 42,
      discussionId: "d_note_thread",
      body: "Fixed by renaming the variable.",
      note: { id: "gl_777", author: "ai-bot", createdAt: "2026-11-05T12:00:00.000Z" },
    });
    const row = await testGet<{ id: string; status: string; resolved_by: string; author: string; body: string; discussion_id: string; created_at: Date }>(
      `SELECT id, status, resolved_by, author, body, discussion_id, created_at FROM comments WHERE id='gl_777'`,
    );
    expect(row && { ...row, created_at: row.created_at.toISOString() }).toEqual({
      id: "gl_777",
      status: "resolved",
      resolved_by: "agent",
      author: "ai-bot",
      body: "Fixed by renaming the variable.",
      discussion_id: "d_note_thread",
      created_at: "2026-11-05T12:00:00.000Z",
    });

    // the poller raced: the same note already arrived via ingest
    await testRun(`INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, status, created_at, updated_at)
            VALUES ('gl_778', $1, 42, 'd_2', 'ai-bot', 'poller beat us', 'open', $2, $3)`, flowId, now(), now());
    await support.recordAgentReply({
      flowId,
      mrIid: 42,
      discussionId: "d_2",
      body: "poller copy",
      note: { id: "gl_778", author: "ai-bot", createdAt: now() },
    });
    expect(await testGet<{ status: string; body: string }>(
      `SELECT status, body FROM comments WHERE id='gl_778'`,
    )).toEqual({ status: "open", body: "poller beat us" });
  });
});
