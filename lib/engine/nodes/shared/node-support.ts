import "server-only";

import { db } from "../../../db";
import { CommentRow, NodeRow, rows } from "../../../db/rows";

/**
 * Persistence helpers for node rows, artifacts, runs and flow-feed events —
 * the shared DB surface every node implementation builds on. Node
 * implementations never import `db` directly: every read/write they need
 * appears here as a named method (T1 seam).
 */
export class NodeSupport {
  nodeByKey(flowId: string, key: string): NodeRow {
    const n = db.get<NodeRow>(`SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key);
    if (!n) throw new Error(`node ${key} not found for flow ${flowId}`);
    return n;
  }

  /** First node row of a given built-in node type (instance keys may differ
   *  from the type; callers that address by node_key use `nodeByKey`). */
  nodeByType(flowId: string, type: string): NodeRow | null {
    return rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND type=?`, flowId, type) ?? null;
  }

  /** A node's current status (null when the row is gone) — polling callers
   *  use this to detect an external cancel/retry mid-wait. */
  nodeStatus(nodeId: string): string | null {
    return db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId)?.status ?? null;
  }

  setNode(id: string, patch: Record<string, unknown>): void {
    const keys = Object.keys(patch);
    db.run(
      `UPDATE nodes SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`,
      ...keys.map((k) => patch[k] as never),
      db.now(),
      id
    );
  }

  /** A chat row scoped to a refinement thread (the plan's sub-plan refines). */
  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null
  ): void {
    db.addMessage(flowId, nodeKey, role, content, thread ?? null);
  }

  saveArtifact(
    nodeId: string,
    flowId: string,
    kind: string,
    content: string,
    meta?: unknown,
    status = "draft"
  ): { id: string; version: number } {
    const prev = db.get<{ v: number | null }>(
      `SELECT MAX(version) v FROM artifacts WHERE node_id=? AND kind=?`,
      nodeId,
      kind
    );
    const version = (prev?.v ?? 0) + 1;
    db.run(
      `UPDATE artifacts SET status='superseded' WHERE node_id=? AND kind=? AND status='draft'`,
      nodeId,
      kind
    );
    const id = db.uid("art_");
    db.run(
      `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, nodeId, flowId, kind, version, content, meta ? JSON.stringify(meta) : null, status, db.now()
    );
    return { id, version };
  }

  persistRun(flowId: string, nodeId: string, agentId: string, runId: string): void {
    // close out any prior `running` rows for this node — they're stale (their
    // process died with a previous server/run) and would otherwise be picked up
    // as the "latest running run" by reconcile, clobbering this fresh run
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), nodeId);
    db.run(
      `INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,status,created_at,updated_at)
       VALUES (?,?,?,?,?,'running',?,?)`,
      db.uid("run_"), flowId, nodeId, agentId, runId, db.now(), db.now()
    );
  }

  lastAgentId(nodeId: string): string | null {
    return db.get<{ agent_ref: string }>(
      `SELECT agent_ref FROM runs WHERE node_id=? ORDER BY created_at DESC LIMIT 1`, nodeId
    )?.agent_ref ?? null;
  }

  /** Update the run row with the real agent/session id once known (local mode). */
  setRunAgentId(runId: string, agentId: string): void {
    db.run(`UPDATE runs SET agent_ref=?, updated_at=? WHERE run_ref=?`, agentId, db.now(), runId);
  }

  /** Mark a node's orphaned run as failed after a server restart (nothing recoverable). */
  failOrphanedNode(flowId: string, nodeId: string, nodeKey: string, reason: string): void {
    const node = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId);
    if (node?.status !== "running") return; // already reconciled
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), nodeId);
    this.setNode(nodeId, { status: "failed" });
    db.emitEvent(flowId, nodeId, "error", `${nodeKey}: ${reason} — retry the node to continue`);
  }

  // ── artifacts ────────────────────────────────────────────────────────────────

  /**
   * The flow's latest artifact of a kind (by version), optionally scoped to
   * the node rows of one type (e.g. only the plan node's plan artifacts when
   * a template holds several nodes that save the same kind). Raw meta comes
   * back unparsed — callers own their schema.
   */
  latestArtifact(
    flowId: string,
    kind: string,
    opts: { nodeType?: string } = {},
  ): { id: string; version: number; content: string; meta: string | null } | null {
    return this.artifactsOfKind(flowId, kind, { ...opts, limit: 1 })[0] ?? null;
  }

  /** A kind's artifacts within a flow, newest first, `limit`-bounded. */
  artifactsOfKind(
    flowId: string,
    kind: string,
    opts: { nodeType?: string; limit?: number } = {},
  ): { id: string; version: number; content: string; meta: string | null }[] {
    const type = opts.nodeType;
    const scope = type ? ` AND n.type=?` : "";
    const cap = opts.limit ? ` LIMIT ${Math.trunc(opts.limit)}` : "";
    if (type) {
      return db.all(
        `SELECT a.id, a.version, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id=a.node_id
         WHERE n.flow_id=? AND a.kind=?${scope}${cap}`,
        flowId, kind, type,
      );
    }
    return db.all(
      `SELECT a.id, a.version, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind=?${scope}${cap}`,
      flowId, kind,
    );
  }

  // ── branches ────────────────────────────────────────────────────────────────

  /** A branch row's MR iid (null when the branch has no merge request yet). */
  branchMrIid(flowId: string, name: string): number | null {
    return db.get<{ mr_iid: number | null }>(
      `SELECT mr_iid FROM branches WHERE flow_id=? AND name=?`, flowId, name,
    )?.mr_iid ?? null;
  }

  // ── comments ────────────────────────────────────────────────────────────────

  /** A flow's open MR comments (validated by the shared row mapper). */
  openComments(flowId: string): CommentRow[] {
    return rows.all(CommentRow, `SELECT * FROM comments WHERE flow_id=? AND status IN ('open')`, flowId);
  }

  /** Record an agent resolution for a comment row. */
  resolveComment(id: string): void {
    db.run(`UPDATE comments SET status='resolved', resolved_by='agent', updated_at=? WHERE id=?`, db.now(), id);
  }

  // ── flows ───────────────────────────────────────────────────────────────────

  /** Point the flow's merge-request branch at `branch`. */
  setFlowBranch(flowId: string, branch: string): void {
    db.run(`UPDATE flows SET mr_branch=? WHERE id=?`, branch, flowId);
  }

  // ── feed events ─────────────────────────────────────────────────────────────

  /** A flow-feed event of any type ("pipeline", "error", "log" — named
   *  lifecycle transitions go through `emitLifecycle`). */
  emit(flowId: string, nodeId: string | null, type: string, message: string, data?: Record<string, unknown>): void {
    db.emitEvent(flowId, nodeId, type, message, data);
  }

  /** The lifecycle event: run transitions and state changes the UI trail is built from. */
  emitLifecycle(flowId: string, nodeId: string | null, message: string, data?: Record<string, unknown>): void {
    db.emitEvent(flowId, nodeId, "lifecycle", message, data);
  }
}

export const nodeSupport = new NodeSupport();
