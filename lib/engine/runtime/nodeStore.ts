import "server-only";

import { db } from "../../db/app";
import { type NodeStatus } from "../../db/rows";
import { ConflictError } from "../../errors";
import { NODE_STATUS } from "../constants/nodeStatus";
import { processSingleton } from "../../singleton";
import { appLayerConfig, mergeConfigLayers } from "../templates/nodeConfig";
import type { TemplateGraph } from "../types/template";
import { nodeRegistry } from "../nodes/registry";
import { hookStore } from "./hookStore";

export type InsertNodeSnapshotsOptions = {
  /** When true, provision wait_for webhook hooks per node (top-level flow create). */
  provisionWebhookHooks?: boolean;
  ts?: string;
};

/**
 * Node table access for engine orchestrators (flow engine, fan-out, reconciler).
 * Node kind implementations use {@link NodeSupport} instead.
 */
export class NodeStore {
  idOf(flowId: string, nodeKey: string): string | null {
    return db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`,
      flowId,
      nodeKey,
    )?.id ?? null;
  }

  statusOf(flowId: string, nodeKey: string): NodeStatus | null {
    return db.get<{ status: NodeStatus }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`,
      flowId,
      nodeKey,
    )?.status ?? null;
  }

  statusesOfFlow(flowId: string): NodeStatus[] {
    return db.all<{ status: NodeStatus }>(`SELECT status FROM nodes WHERE flow_id=?`, flowId)
      .map((n) => n.status);
  }

  setStatus(flowId: string, nodeKey: string, status: NodeStatus): void {
    db.run(
      `UPDATE nodes SET status=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status,
      db.now(),
      flowId,
      nodeKey,
    );
  }

  /**
   * Atomically move a node to `running` and stamp a fresh attempt token.
   * Throws {@link ConflictError} when the node is not in one of `from`.
   */
  claim(flowId: string, nodeKey: string, from: readonly NodeStatus[]): string {
    const attempt = db.uid("att_");
    const marks = from.map(() => "?").join(",");
    const { changes } = db.run(
      `UPDATE nodes SET status = ?, attempt_id = ?, updated_at = ?
       WHERE flow_id = ? AND node_key = ? AND status IN (${marks})`,
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

  emitEvent(
    flowId: string,
    nodeKey: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const nodeId = nodeKey ? this.idOf(flowId, nodeKey) : null;
    db.emitEvent(flowId, nodeId, type, message, data);
  }

  /** Insert node rows from a template graph snapshot (flow / step / split create). */
  insertSnapshots(flowId: string, graph: TemplateGraph, opts: InsertNodeSnapshotsOptions = {}): void {
    const ts = opts.ts ?? db.now();
    for (const spec of graph.nodes) {
      const def = nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        db.uid("node_"),
        flowId,
        spec.key,
        spec.defKey,
        spec.label === def.label ? null : spec.label,
        JSON.stringify(config),
        spec.joinMode,
        NODE_STATUS.PENDING,
        ts,
        ts,
      );
      if (opts.provisionWebhookHooks && spec.trigger.wait_for === "webhook") {
        hookStore.ensureForNode(flowId, spec.key);
      }
    }
  }
}

export const nodeStore = processSingleton("nodeStore", () => new NodeStore());
