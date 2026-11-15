import "server-only";

import { db } from "../../../db/app";
import { CommentRow, NodeRow, rows, type NodeStatus } from "../../../db/rows";
import { ConflictError } from "../../../errors";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { ARTIFACT_STATUS, COMMENT_STATUS, EVENT_KIND, RESOLVED_BY_AGENT, RUN_AGENT_REF, RUN_STATUS } from "../../constants/vocabulary";
import type { HostNote } from "../../ports/gitHost";
import { RunSupersededError } from "../../errors/runSupersededError";
import { nodeAttemptRegistry } from "../../runtime/nodeAttemptRegistry";

const NODE_SELECT = `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status,
       attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef",
       session_id AS "sessionId", prompt_override AS "promptOverride", label, config,
       join_mode AS "joinMode", input, output, created_at AS "createdAt",
       updated_at AS "updatedAt" FROM nodes`;
const COMMENT_SELECT = `SELECT id, flow_id AS "flowId", mr_iid AS "mrIid",
       discussion_id AS "discussionId", author, body, file_path AS "filePath", line,
       status, resolved_by AS "resolvedBy", raw, created_at AS "createdAt",
       updated_at AS "updatedAt" FROM comments`;

/**
 * Persistence helpers for node rows, artifacts, runs and flow-feed events —
 * the shared DB surface every node implementation builds on. Node
 * implementations never import `db` directly: every read/write they need
 * appears here as a named method (T1 seam).
 */
export class NodeSupport {
  async nodeByKey(flowId: string, key: string): Promise<NodeRow> {
    const n = await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND node_key=$2`, flowId, key);
    if (!n) throw new Error(`node ${key} not found for flow ${flowId}`);
    return n;
  }

  /** Like nodeByKey but null when the instance key is absent (optional chain stages). */
  async optionalNodeByKey(flowId: string, key: string): Promise<NodeRow | null> {
    return (await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND node_key=$2`, flowId, key)) ?? null;
  }

  /** First node row of a given built-in node type (instance keys may differ
   *  from the type; callers that address by node_key use `nodeByKey`). */
  async nodeByType(flowId: string, type: string): Promise<NodeRow | null> {
    return (await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND type=$2`, flowId, type)) ?? null;
  }

  /** A node's current status (null when the row is gone) — polling callers
   *  use this to detect an external cancel/retry mid-wait. */
  async nodeStatus(nodeId: string): Promise<string | null> {
    return (await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status ?? null;
  }

  async setNode(id: string, patch: Record<string, unknown>): Promise<void> {
    if (typeof patch.status === "string" && patch.status !== NODE_STATUS.RUNNING) {
      nodeAttemptRegistry.clear(id);
    }
    const keys = Object.keys(patch);
    await db.run(
      `UPDATE nodes SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`,
      ...keys.map((k) => patch[k] as never),
      db.now(),
      id
    );
  }

  /**
   * Atomically move a node to `running` and stamp a fresh attempt token.
   * Throws {@link ConflictError} when the node is not in one of `from`.
   */
  async claim(flowId: string, nodeKey: string, from: readonly NodeStatus[]): Promise<string> {
    const attempt = db.uid("att_");
    const marks = from.map((_, i) => `$${i + 5}`).join(",");
    const changes = await db.run(
      `UPDATE nodes SET status = $1, attempt_id = $2, updated_at = $3
       WHERE flow_id = $4 AND node_key = $5 AND status IN (${marks})`,
      NODE_STATUS.RUNNING,
      attempt,
      db.now(),
      flowId,
      nodeKey,
      ...from,
    );
    if (changes !== 1) {
      throw new ConflictError(`Node ${nodeKey} is not in ${from.join("/")}`);
    }
    return attempt;
  }

  /**
   * Atomically transition status when the node is in one of `from`.
   * Clears `attempt_id` when leaving `running`.
   */
  async transition(
    flowId: string,
    nodeKey: string,
    from: readonly NodeStatus[],
    to: NodeStatus,
  ): Promise<void> {
    const marks = from.map((_, i) => `$${i + 5}`).join(",");
    const clearAttempt = to !== NODE_STATUS.RUNNING;
    const changes = await db.run(
      `UPDATE nodes SET status = $1, attempt_id = $2, updated_at = $3
       WHERE flow_id = $4 AND node_key = $5 AND status IN (${marks})`,
      to,
      clearAttempt ? null : db.uid("att_"),
      db.now(),
      flowId,
      nodeKey,
      ...from,
    );
    if (changes !== 1) {
      throw new ConflictError(`Node ${nodeKey} is not in ${from.join("/")}`);
    }
  }

  /** Terminal (or mid-run) patch fenced by the active attempt token. */
  async patchIfAttempt(nodeId: string, attemptId: string, patch: Record<string, unknown>): Promise<void> {
    const status = patch.status;
    const merged: Record<string, unknown> =
      typeof status === "string" && status !== NODE_STATUS.RUNNING
        ? { ...patch, attempt_id: null }
        : { ...patch };
    const mergedKeys = Object.keys(merged);
    const changes = await db.run(
      `UPDATE nodes SET ${mergedKeys.map((k, i) => `${k}=$${i + 1}`).join(",")}, updated_at=$${mergedKeys.length + 1} WHERE id=$${mergedKeys.length + 2} AND attempt_id=$${mergedKeys.length + 3}`,
      ...mergedKeys.map((k) => merged[k] as never),
      db.now(),
      nodeId,
      attemptId,
    );
    if (changes !== 1) {
      const node = await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId);
      throw new RunSupersededError(nodeId, node?.status ?? "unknown", attemptId);
    }
  }

  async attemptId(nodeId: string): Promise<string | null> {
    return (await db.get<{ attemptId: string | null }>(`SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`, nodeId))
      ?.attemptId ?? null;
  }

  /** A chat row scoped to a refinement thread (the plan's sub-plan refines). */
  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null
  ): Promise<void> {
    return db.addMessage(flowId, nodeKey, role, content, thread ?? null);
  }

  async saveArtifact(
    nodeId: string,
    flowId: string,
    kind: string,
    content: string,
    meta?: unknown,
    status = ARTIFACT_STATUS.DRAFT
  ): Promise<{ id: string; version: number }> {
    const prev = await db.get<{ v: number | null }>(
      `SELECT MAX(version) AS v FROM artifacts WHERE node_id=$1 AND kind=$2`,
      nodeId,
      kind
    );
    const version = (prev?.v ?? 0) + 1;
    await db.run(
      `UPDATE artifacts SET status=$1 WHERE node_id=$2 AND kind=$3 AND status=$4`,
      ARTIFACT_STATUS.SUPERSEDED,
      nodeId,
      kind,
      ARTIFACT_STATUS.DRAFT,
    );
    const id = db.uid("art_");
    await db.run(
      `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      id, nodeId, flowId, kind, version, content, meta ? JSON.stringify(meta) : null, status, db.now()
    );
    return { id, version };
  }

  /**
   * Placeholder run row for the current attempt — written at the start of
   * `executeRun` so reconcile sees a run while the agent is still starting.
   * `run_ref` is the attempt token until `persistRun` upgrades the row.
   */
  async registerStartupRun(flowId: string, nodeId: string, attemptId: string): Promise<void> {
    const existing = await db.get<{ agentRef: string; runRef: string }>(
      `SELECT agent_ref AS "agentRef", run_ref AS "runRef" FROM runs
       WHERE node_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1`,
      nodeId,
      RUN_STATUS.RUNNING,
    );
    if (existing?.agentRef === RUN_AGENT_REF.PENDING && existing.runRef === attemptId) {
      return;
    }
    await db.run(
      `UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4`,
      RUN_STATUS.ERROR,
      db.now(),
      nodeId,
      RUN_STATUS.RUNNING,
    );
    const id = db.uid("run_");
    await db.run(
      `INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      id,
      flowId,
      nodeId,
      RUN_AGENT_REF.PENDING,
      attemptId,
      RUN_STATUS.RUNNING,
      db.now(),
      db.now(),
    );
  }

  isStartupRun(agentRef: string): boolean {
    return agentRef === RUN_AGENT_REF.PENDING;
  }

  async persistRun(flowId: string, nodeId: string, agentId: string, runId: string): Promise<string> {
    const attemptRow = await db.get<{ attemptId: string | null }>(
      `SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`,
    nodeId,
    );
    const attemptId = attemptRow?.attemptId;
    if (attemptId) {
      const changes = await db.run(
        `UPDATE runs SET agent_ref=$1, run_ref=$2, updated_at=$3
         WHERE node_id=$4 AND status=$5 AND agent_ref=$6 AND run_ref=$7`,
        agentId,
        runId,
        db.now(),
        nodeId,
        RUN_STATUS.RUNNING,
    RUN_AGENT_REF.PENDING,
        attemptId,
      );
      if (changes === 1) {
        const upgraded = await db.get<{ id: string }>(`SELECT id FROM runs WHERE run_ref=$1`, runId);
        if (upgraded) {
          await db.run(
            `UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4 AND run_ref<>$5`,
            RUN_STATUS.ERROR,
            db.now(),
            nodeId,
            RUN_STATUS.RUNNING,
            runId,
          );
          return upgraded.id;
        }
      }
    }
    // close out any prior `running` rows for this node — they're stale (their
    // process died with a previous server/run) and would otherwise be picked up
    // as the "latest running run" by reconcile, clobbering this fresh run
    await db.run(`UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4`, RUN_STATUS.ERROR, db.now(), nodeId, RUN_STATUS.RUNNING);
    const id = db.uid("run_");
    await db.run(
      `INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      id, flowId, nodeId, agentId, runId, RUN_STATUS.RUNNING, db.now(), db.now()
    );
    return id;
  }

  async lastAgentId(nodeId: string): Promise<string | null> {
    return (await db.get<{ agentRef: string }>(
      `SELECT agent_ref AS "agentRef" FROM runs WHERE node_id=$1 AND agent_ref<>$2 ORDER BY created_at DESC LIMIT 1`,
      nodeId,
      RUN_AGENT_REF.PENDING,
    ))?.agentRef ?? null;
  }

  /** Update the run row with the real agent/session id once known (local mode). */
  async setRunAgentId(runId: string, agentId: string): Promise<void> {
    await db.run(`UPDATE runs SET agent_ref=$1, updated_at=$2 WHERE run_ref=$3`, agentId, db.now(), runId);
  }

  /** Mark a node's orphaned run as failed after a server restart (nothing recoverable). */
  async failOrphanedNode(flowId: string, nodeId: string, nodeKey: string, reason: string): Promise<void> {
    const node = await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId);
    if (node?.status !== NODE_STATUS.RUNNING) return; // already reconciled
    await db.run(
      `UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4`,
      RUN_STATUS.ERROR,
      db.now(),
      nodeId,
      RUN_STATUS.RUNNING,
    );
    await this.setNode(nodeId, { status: NODE_STATUS.FAILED });
    await db.emitEvent(flowId, nodeId, EVENT_KIND.ERROR, `${nodeKey}: ${reason} — retry the node to continue`);
  }

  // ── artifacts ────────────────────────────────────────────────────────────────

  /**
   * The flow's latest artifact of a kind (by version), optionally scoped to
   * the node rows of one type (e.g. only the plan node's plan artifacts when
   * a template holds several nodes that save the same kind). Raw meta comes
   * back unparsed — callers own their schema.
   */
  async latestArtifact(
    flowId: string,
    kind: string,
    opts: { nodeType?: string } = {},
  ): Promise<{ id: string; version: number; content: string; meta: unknown } | null> {
    return (await this.artifactsOfKind(flowId, kind, { ...opts, limit: 1 }))[0] ?? null;
  }

  /** A kind's artifacts within a flow, newest first, `limit`-bounded. */
  async artifactsOfKind(
    flowId: string,
    kind: string,
    opts: { nodeType?: string; limit?: number } = {},
  ): Promise<{ id: string; version: number; content: string; meta: unknown }[]> {
    const type = opts.nodeType;
    const scope = type ? ` AND n.type=$3` : "";
    const cap = opts.limit ? ` LIMIT ${Math.trunc(opts.limit)}` : "";
    const sql = `SELECT a.id, a.version, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id=a.nodeId
       WHERE n.flowId=$1 AND a.kind=$2${scope}
       ORDER BY a.version DESC, a.createdAt DESC${cap}`;
    return type ? await db.all(sql, flowId, kind, type) : await db.all(sql, flowId, kind);
  }

  // ── branches ────────────────────────────────────────────────────────────────

  /** A branch row's MR iid (null when the branch has no merge request yet). */
  async branchMrIid(flowId: string, name: string): Promise<number | null> {
    return (await db.get<{ mrIid: number | null }>(
      `SELECT mr_iid AS "mrIid" FROM branches WHERE flow_id=$1 AND name=$2`, flowId, name,
    ))?.mrIid ?? null;
  }

  // ── comments ────────────────────────────────────────────────────────────────

  /**
   * A flow's open MR comments (validated by the shared row mapper), in
   * deterministic order (G12) — the resolve prompt's comment list and the
   * contract's decision coverage are built from this ordering.
   */
  async openComments(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    if (mrIid != null) {
      return rows.all(
        CommentRow,
        `${COMMENT_SELECT} WHERE flow_id=$1 AND status=$2 AND mr_iid=$3 ORDER BY created_at ASC, id ASC`,
        flowId,
        COMMENT_STATUS.OPEN,
        mrIid,
      );
    }
    return rows.all(
      CommentRow,
      `${COMMENT_SELECT} WHERE flow_id=$1 AND status=$2 ORDER BY created_at ASC, id ASC`,
      flowId,
      COMMENT_STATUS.OPEN,
    );
  }

  /** Record an agent resolution for a comment row. */
  resolveComment(id: string): Promise<void> {
    return this.resolveComments([id]);
  }

  /**
   * Mark several comment rows resolved-by-agent in one statement (G9) —
   * multi-note threads store one row per note, so every row of a resolved
   * discussion is closed together behind a single per-discussion host call.
   * No-op for an empty id list.
   */
  async resolveComments(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const marks = ids.map((_, i) => `$${i + 4}`).join(",");
    await db.run(
      `UPDATE comments SET status=$1, resolved_by=$2, updated_at=$3 WHERE id IN (${marks})`,
      COMMENT_STATUS.RESOLVED,
      RESOLVED_BY_AGENT,
      db.now(),
      ...ids,
    );
  }

  /**
   * The MR's agent-authored comment rows (`resolved_by='agent'`) — the resolve
   * prompt's "already replied — awaiting reviewer" markers (G11): an open row
   * in the same discussion means the agent answered it last cycle and the
   * reviewer hasn't responded yet. Deterministic order for the prompt.
   */
  async agentReplies(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    if (mrIid != null) {
      return rows.all(
        CommentRow,
        `${COMMENT_SELECT} WHERE flow_id=$1 AND mr_iid=$2 AND resolved_by=$3 ORDER BY created_at ASC, id ASC`,
        flowId,
        mrIid,
        RESOLVED_BY_AGENT,
      );
    }
    return rows.all(
      CommentRow,
      `${COMMENT_SELECT} WHERE flow_id=$1 AND resolved_by=$2 ORDER BY created_at ASC, id ASC`,
      flowId,
      RESOLVED_BY_AGENT,
    );
  }

  /**
   * Insert the agent's just-posted thread reply as a local comment row (G10):
   * `resolved` + `resolved_by='agent'` keeps the `commentStore.ingest` guard
   * from re-opening it when the poller/webhook later deliver the same note,
   * and `presentComments` reads the row as the "already replied" marker.
   * Skips when a poll raced us and already ingested the host-prefixed note id.
   */
  async recordAgentReply(params: {
    flowId: string;
    mrIid: number | null;
    discussionId: string;
    body: string;
    note: HostNote;
  }): Promise<void> {
    const existing = await db.get<{ id: string }>(`SELECT id FROM comments WHERE id=$1`, params.note.id);
    if (existing) return;
    await db.run(
      `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,resolved_by,raw,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      params.note.id,
      params.flowId,
      params.mrIid,
      params.discussionId,
      params.note.author,
      params.body,
      null,
      null,
      COMMENT_STATUS.RESOLVED,
      RESOLVED_BY_AGENT,
      null,
      params.note.createdAt,
      db.now(),
    );
  }

  // ── flows ───────────────────────────────────────────────────────────────────

  /** Point the flow's merge-request branch at `branch`. */
  async setFlowBranch(flowId: string, branch: string): Promise<void> {
    await db.run(`UPDATE flows SET mr_branch=$1 WHERE id=$2`, branch, flowId);
  }

  // ── feed events ─────────────────────────────────────────────────────────────

  /** A flow-feed event of any type ("pipeline", "error", "log" — named
   *  lifecycle transitions go through `emitLifecycle`). */
  emit(flowId: string, nodeId: string | null, type: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return db.emitEvent(flowId, nodeId, type, message, data);
  }

  /** The lifecycle event: run transitions and state changes the UI trail is built from. */
  emitLifecycle(flowId: string, nodeId: string | null, message: string, data?: Record<string, unknown>): Promise<void> {
    return db.emitEvent(flowId, nodeId, EVENT_KIND.LIFECYCLE, message, data);
  }
}

export const nodeSupport = new NodeSupport();
