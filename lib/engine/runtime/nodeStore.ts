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
import { nodeAttemptRegistry } from "./nodeAttemptRegistry";

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
  async idOf(flowId: string, nodeKey: string): Promise<string | null> {
    const row = await db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId,
      nodeKey,
    );
    return row?.id ?? null;
  }

  async statusOf(flowId: string, nodeKey: string): Promise<NodeStatus | null> {
    const row = await db.get<{ status: NodeStatus }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId,
      nodeKey,
    );
    return row?.status ?? null;
  }

  async statusesOfFlow(flowId: string): Promise<NodeStatus[]> {
    const rows = await db.all<{ status: NodeStatus }>(`SELECT status FROM nodes WHERE flow_id=$1`, flowId);
    return rows.map((n) => n.status);
  }

  async setStatus(flowId: string, nodeKey: string, status: NodeStatus): Promise<void> {
    await db.run(
      `UPDATE nodes SET status=$1, updated_at=$2 WHERE flow_id=$3 AND node_key=$4`,
      status,
      db.now(),
      flowId,
      nodeKey,
    );
    if (status !== NODE_STATUS.RUNNING) {
      const nodeId = await this.idOf(flowId, nodeKey);
      if (nodeId) nodeAttemptRegistry.clear(nodeId);
    }
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

  async emitEvent(
    flowId: string,
    nodeKey: string | null,
    async type: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const nodeId = nodeKey ? await this.idOf(flowId, nodeKey) : null;
    await db.emitEvent(flowId, nodeId, type, message, data);
  }

  /** Insert node rows from a template graph snapshot (flow / step / split create). */
  async insertSnapshots(flowId: string, graph: TemplateGraph, opts: InsertNodeSnapshotsOptions = {}): Promise<void> {
    const ts = opts.ts ?? db.now();
    for (const spec of graph.nodes) {
      const def = nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      await db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
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
      if (opts.provisionWebhookHooks && spec.trigger.waitFor === "webhook") {
        await hookStore.ensureForNode(flowId, spec.key);
      }
    }
  }
}

export const nodeStore = processSingleton("nodeStore", () => new NodeStore());
