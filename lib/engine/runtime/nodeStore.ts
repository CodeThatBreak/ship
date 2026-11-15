import "server-only";

import { db } from "../../db/app";
import { type NodeStatus } from "../../db/rows";
import { ConflictError } from "../../errors";
import { NODE_STATUS } from "../constants/nodeStatus";
import { processSingleton } from "../../singleton";
import { appLayerConfig, mergeConfigLayers } from "../templates/nodeConfig";
import type { TemplateGraph } from "../types/template";
import type { QueryExecutor } from "../../db/database";
import type { Prisma } from "@prisma/client";
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
  async idOf(flowId: string, nodeKey: string, tx?: QueryExecutor): Promise<string | null> {
    const row = await (tx ?? db.prisma).node.findFirst({
      where: { flowId, nodeKey },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async statusOf(flowId: string, nodeKey: string, tx?: QueryExecutor): Promise<NodeStatus | null> {
    const row = await (tx ?? db.prisma).node.findFirst({
      where: { flowId, nodeKey },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  async statusesOfFlow(flowId: string, tx?: QueryExecutor): Promise<NodeStatus[]> {
    const rows = await (tx ?? db.prisma).node.findMany({
      where: { flowId },
      select: { status: true },
    });
    return rows.map((n) => n.status);
  }

  async setStatus(flowId: string, nodeKey: string, status: NodeStatus, tx?: QueryExecutor): Promise<void> {
    await (tx ?? db.prisma).node.updateMany({
      where: { flowId, nodeKey },
      data: { status, updatedAt: new Date() },
    });
    if (status !== NODE_STATUS.RUNNING) {
      const nodeId = await this.idOf(flowId, nodeKey, tx);
      if (nodeId) nodeAttemptRegistry.clear(nodeId);
    }
  }

  /**
   * Atomically move a node to `running` and stamp a fresh attempt token.
   * Throws {@link ConflictError} when the node is not in one of `from`.
   */
  async claim(flowId: string, nodeKey: string, from: readonly NodeStatus[]): Promise<string> {
    const attempt = db.uid("att_");
    const { count } = await db.prisma.node.updateMany({
      where: { flowId, nodeKey, status: { in: [...from] } },
      data: { status: NODE_STATUS.RUNNING, attemptId: attempt, updatedAt: new Date() },
    });
    if (count !== 1) {
      throw new ConflictError(`Node ${nodeKey} is not in ${from.join("/")}`);
    }
    return attempt;
  }

  async emitEvent(
    flowId: string,
    nodeKey: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
    tx?: QueryExecutor,
  ): Promise<void> {
    const nodeId = nodeKey ? await this.idOf(flowId, nodeKey, tx) : null;
    await db.emitEvent(flowId, nodeId, type, message, data, tx);
  }

  /** Insert node rows from a template graph snapshot (flow / step / split create). */
  async insertSnapshots(
    flowId: string,
    graph: TemplateGraph,
    opts: InsertNodeSnapshotsOptions = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? db.prisma;
    const ts = opts.ts ? new Date(opts.ts) : new Date();
    for (const spec of graph.nodes) {
      const def = await nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), await appLayerConfig(def.key), spec.config);
      await client.node.create({
        data: {
          id: db.uid("node_"),
          flowId,
          nodeKey: spec.key,
          type: spec.defKey,
          label: spec.label === def.label ? null : spec.label,
          config: config as never,
          joinMode: spec.joinMode,
          status: NODE_STATUS.PENDING,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      if (opts.provisionWebhookHooks && spec.trigger.waitFor === "webhook") {
        await hookStore.ensureForNode(flowId, spec.key, tx);
      }
    }
  }
}

export const nodeStore = processSingleton("nodeStore", () => new NodeStore());
