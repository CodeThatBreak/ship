/**
 * NodeSupport artifact queries — ordering must match "newest first" so
 * `latestArtifact` and plan/build consumers see the approved version.
 *
 * Isolated temp SQLite DB (AGENTS.md §1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-support-")),
  "test.db",
);

const { db } = await import("../../../db/app");
const { NodeSupport } = await import("./nodeSupport");
const { ConflictError } = await import("../../../errors");

const now = () => new Date().toISOString();

const seedPlanNode = (flowId: string) => {
  const taskId = `task_${flowId}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId,
    "generic",
    `TST-${flowId}`,
    "node-support test",
    "open",
    "task",
    "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId,
    taskId,
    "node-support test",
    "active",
    now(),
    now(),
  );
  const nodeId = `node_${flowId}`;
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
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
  const support = new NodeSupport();

  it("latestArtifact and artifactsOfKind return newest plan versions first", () => {
    const flowId = "flw_art_order";
    const nodeId = seedPlanNode(flowId);

    support.saveArtifact(nodeId, flowId, "plan", "# Plan v1", { steps: [], branches: [] });
    support.saveArtifact(nodeId, flowId, "plan", "# Plan v2", { steps: [], branches: [] });
    support.saveArtifact(nodeId, flowId, "plan", "# Plan v3", { steps: [], branches: [] });

    const latest = support.latestArtifact(flowId, "plan", { nodeType: "plan" });
    expect(latest?.version).toBe(3);
    expect(latest?.content).toBe("# Plan v3");

    const all = support.artifactsOfKind(flowId, "plan", { nodeType: "plan" });
    expect(all.map((a) => a.version)).toEqual([3, 2, 1]);
  });
});

describe("NodeSupport — startup run rows", () => {
  const support = new NodeSupport();

  it("registerStartupRun is idempotent and persistRun upgrades the placeholder", () => {
    const flowId = "flw_startup_run";
    const nodeId = seedPlanNode(flowId);
    db.run(`UPDATE nodes SET status='running', attempt_id='att_test' WHERE id=?`, nodeId);

    support.registerStartupRun(flowId, nodeId, "att_test");
    support.registerStartupRun(flowId, nodeId, "att_test");

    const pending = db.get<{ agent_ref: string; run_ref: string; status: string }>(
      `SELECT agent_ref, run_ref, status FROM runs WHERE node_id=? AND status='running'`,
      nodeId,
    );
    expect(pending).toMatchObject({
      agent_ref: "pending",
      run_ref: "att_test",
      status: "running",
    });

    const runRowId = support.persistRun(flowId, nodeId, "agt_real", "run_real");
    const upgraded = db.get<{ id: string; agent_ref: string; run_ref: string }>(
      `SELECT id, agent_ref, run_ref FROM runs WHERE id=?`,
      runRowId,
    );
    expect(upgraded).toMatchObject({ agent_ref: "agt_real", run_ref: "run_real" });
    expect(support.lastAgentId(nodeId)).toBe("agt_real");
  });
});

describe("NodeSupport.claim (Task 17)", () => {
  const support = new NodeSupport();

  it("stamps attempt_id and rejects a second concurrent claim", () => {
    const flowId = "flw_claim";
    const nodeId = seedPlanNode(flowId);
    db.run(`UPDATE nodes SET status='pending' WHERE id=?`, nodeId);

    const first = support.claim(flowId, "plan", ["pending"]);
    expect(first.startsWith("att_")).toBe(true);
    expect(db.get<{ status: string; attempt_id: string }>(
      `SELECT status, attempt_id FROM nodes WHERE id=?`,
      nodeId,
    )).toMatchObject({ status: "running", attempt_id: first });

    expect(() => support.claim(flowId, "plan", ["pending"])).toThrow(ConflictError);
  });

  it("transition moves status only from allowed sources", () => {
    const flowId = "flw_transition";
    seedPlanNode(flowId);
    support.transition(flowId, "plan", ["awaiting_approval"], "approved");
    expect(db.get<{ status: string; attempt_id: null }>(
      `SELECT status, attempt_id FROM nodes WHERE flow_id=? AND node_key='plan'`,
      flowId,
    )).toMatchObject({ status: "approved", attempt_id: null });
  });
});

describe("NodeSupport — comment queries and agent reply effects", () => {
  const support = new NodeSupport();

  /** Seed an open comment row with an explicit timestamp (ordering control). */
  const seedOpenComment = (
    flowId: string,
    id: string,
    overrides: { mrIid?: number; discussionId?: string; createdAt?: string } = {},
  ) => {
    db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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

  it("openComments orders deterministically by created_at then id (G12)", () => {
    const flowId = "flw_comments_order";
    seedPlanNode(flowId);
    // insertion order shuffled against both sort keys: id ASC is the tie-break,
    // created_at ASC is primary regardless of insertion order
    seedOpenComment(flowId, "gl_2", { createdAt: "2026-11-04T10:00:00.000Z" });
    seedOpenComment(flowId, "gl_1", { createdAt: "2026-11-04T10:00:00.000Z" });
    seedOpenComment(flowId, "gl_4", { createdAt: "2026-11-03T09:00:00.000Z" });
    seedOpenComment(flowId, "gl_3", { createdAt: "2026-11-05T08:00:00.000Z" });

    expect(support.openComments(flowId).map((c) => c.id)).toEqual(["gl_4", "gl_1", "gl_2", "gl_3"]);
    expect(support.openComments(flowId, 42).map((c) => c.id)).toEqual([]);
  });

  it("resolveComments marks every given row resolved-by-agent and no-ops on empty", () => {
    const flowId = "flw_comments_resolve";
    seedPlanNode(flowId);
    seedOpenComment(flowId, "gl_10", { mrIid: 7 });
    seedOpenComment(flowId, "gl_11", { mrIid: 7 });
    seedOpenComment(flowId, "gl_12", { mrIid: 7 });

    support.resolveComments([]);

    support.resolveComments(["gl_10", "gl_11"]);
    expect(
      db.all<{ id: string; status: string; resolved_by: string }>(
        `SELECT id, status, resolved_by FROM comments WHERE flow_id=? ORDER BY id`,
        flowId,
      ),
    ).toEqual([
      { id: "gl_10", status: "resolved", resolved_by: "agent" },
      { id: "gl_11", status: "resolved", resolved_by: "agent" },
      { id: "gl_12", status: "open", resolved_by: null },
    ]);
    // the single-row method delegates to the same batch path
    support.resolveComment("gl_12");
    expect(db.get<{ status: string; resolved_by: string }>(
      `SELECT status, resolved_by FROM comments WHERE id=?`,
      "gl_12",
    )).toEqual({ status: "resolved", resolved_by: "agent" });
  });

  it("recordAgentReply inserts the posted note closed-by-agent and skips raced ingests (G10)", () => {
    const flowId = "flw_agent_reply";
    seedPlanNode(flowId);

    support.recordAgentReply({
      flowId,
      mrIid: 42,
      discussionId: "d_note_thread",
      body: "Fixed by renaming the variable.",
      note: { id: "gl_777", author: "ai-bot", createdAt: "2026-11-05T12:00:00.000Z" },
    });
    const row = db.get<{ id: string; status: string; resolved_by: string; author: string; body: string; discussion_id: string; created_at: string }>(
      `SELECT id, status, resolved_by, author, body, discussion_id, created_at FROM comments WHERE id='gl_777'`,
    );
    expect(row).toEqual({
      id: "gl_777",
      status: "resolved",
      resolved_by: "agent",
      author: "ai-bot",
      body: "Fixed by renaming the variable.",
      discussion_id: "d_note_thread",
      created_at: "2026-11-05T12:00:00.000Z",
    });

    // the poller raced: the same note already arrived via ingest
    db.run(`INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, status, created_at, updated_at)
            VALUES ('gl_778', ?, 42, 'd_2', 'ai-bot', 'poller beat us', 'open', ?, ?)`, flowId, now(), now());
    support.recordAgentReply({
      flowId,
      mrIid: 42,
      discussionId: "d_2",
      body: "poller copy",
      note: { id: "gl_778", author: "ai-bot", createdAt: now() },
    });
    expect(db.get<{ status: string; body: string }>(
      `SELECT status, body FROM comments WHERE id='gl_778'`,
    )).toEqual({ status: "open", body: "poller beat us" });
  });
});
