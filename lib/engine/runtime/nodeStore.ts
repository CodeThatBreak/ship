import "server-only";

import { db } from "../../db/app";
import { type NodeStatus } from "../../db/constants/rowStatuses";
import { NODE_STATUS } from "../constants/nodeStatus";
import { appLayerConfig, mergeConfigLayers } from "../templates/nodeConfig";
import type { TemplateGraph } from "../types/template";
import type { QueryExecutor } from "../../db/database";
import type { Prisma } from "@prisma/client";
import { hookStore } from "./hookStore";
import type { InsertNodeSnapshotsOptions } from "./types/nodeStore";

/**
 * Node table access for engine orchestrators (flow engine, fan-out, reconciler).
 * Node kind implementations use {@link NodeSupport} instead. Statusless
 * after step 02: every status/attempt write belongs to the
 * `TransitionAuthority` (`runtime/transitions/`); this class only reads node
 * rows, inserts flow-creation snapshots (`[*] → pending`, the state
 * machine's birth edge) and emits events. Constructed in `lib/composition`
 * (decision Q9).
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
    // CONSTRUCTION-CYCLE BREAK (step 02): the node registry statically imports
    // the node kinds, whose base classes import the composition root for the
    // shared `nodeSupport` — importing the registry here at module scope would
    // loop `composition → nodeStore → registry → kinds → composition`. The
    // lazy import resolves against the module cache on first use, after both
    // sides of the cycle have finished evaluating.
    const { nodeRegistry } = await import("../nodes/registry");
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
