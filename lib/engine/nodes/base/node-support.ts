import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";

/**
 * Persistence helpers for node rows, artifacts and run rows — the shared
 * DB surface every node implementation builds on.
 */
export class NodeSupport {
  nodeByKey(flowId: string, key: string): NodeRow {
    const n = db.get<NodeRow>(`SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key);
    if (!n) throw new Error(`node ${key} not found for flow ${flowId}`);
    return n;
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
      `INSERT INTO runs (id,flow_id,node_id,cursor_agent_id,cursor_run_id,status,created_at,updated_at)
       VALUES (?,?,?,?,?,'running',?,?)`,
      db.uid("run_"), flowId, nodeId, agentId, runId, db.now(), db.now()
    );
  }

  lastAgentId(nodeId: string): string | null {
    return db.get<{ cursor_agent_id: string }>(
      `SELECT cursor_agent_id FROM runs WHERE node_id=? ORDER BY created_at DESC LIMIT 1`, nodeId
    )?.cursor_agent_id ?? null;
  }

  /** Update the run row with the real agent/session id once known (local mode). */
  setRunAgentId(runId: string, agentId: string): void {
    db.run(`UPDATE runs SET cursor_agent_id=?, updated_at=? WHERE cursor_run_id=?`, agentId, db.now(), runId);
  }

  /** Stamp this process as the owner of a run and start its heartbeat clock. */
  claimRun(runId: string): void {
    db.run(`UPDATE runs SET owner_pid=?, last_heartbeat_at=? WHERE cursor_run_id=?`,
      process.pid, db.now(), runId);
  }

  /** Mark a node's orphaned run as failed after a server restart (nothing recoverable). */
  failOrphanedNode(flowId: string, nodeId: string, nodeKey: string, reason: string): void {
    const node = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId);
    if (node?.status !== "running") return; // already reconciled
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), nodeId);
    this.setNode(nodeId, { status: "failed" });
    db.emitEvent(flowId, nodeId, "error", `${nodeKey}: ${reason} — retry the node to continue`);
  }
}

export const nodeSupport = new NodeSupport();
