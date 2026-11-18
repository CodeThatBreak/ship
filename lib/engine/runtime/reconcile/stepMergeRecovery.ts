import "server-only";

import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { engineParts } from "../../../composition/container";
import { stepFlows } from "../fanout/stepFlowManager";
import { mergeArena } from "../fanout/mergeArena";
import { FLOW_SELECT } from "./constants/flowSelect";
import { STEP_MERGE_GRACE_MS } from "./constants/reconcileTiming";

/**
 * StepMergeRecovery — the plan fan-out's stuck merge-backs and orphan
 * children (Phase 2B, ported from the step-03 Reconciler v2 split).
 * `step_merges` rows are durable (written before git), so after a restart:
 *  - a row still `running`/`conflict`/`rejected` whose owning process is
 *    dead resumes the merge arena (bounded by the merge-fix budget) when the
 *    child is still approved/pending — or flags failed loudly (event on the
 *    parent, failed-visible step card) when the child is red/dead;
 *  - orphan children (the `plan_steps.subFlowId` linkage or the parent
 *    fan-out node gone) surface on the parent once; they are inert.
 * In-flight merges of the live process are never double-booked
 * (`mergeArena.isMerging`).
 *
 * The node-state walk (expired running nodes of a child flow) is delegated
 * back to the owning {@link Reconciler} through `bind` — the walker owns
 * node recovery, this class owns merge recovery.
 */
export class StepMergeRecovery {
  private reconcileNodes: ((flow: FlowRow) => Promise<void>) | null = null;
  /** step children already flagged orphaned in this process (event dedup) */
  private readonly flaggedOrphans = new Set<string>();

  /** Wire the owning Reconciler's node-state walk (cycle break). */
  bind(reconcileNodes: (flow: FlowRow) => Promise<void>): void {
    this.reconcileNodes = reconcileNodes;
  }

  /** Drop orphan-dedup entries for flows that are gone or inactive. */
  async prune(activeFlowIds: Set<string>): Promise<void> {
    for (const id of [...this.flaggedOrphans]) {
      if (activeFlowIds.has(id)) continue;
      const row = await db.prisma.flow.findUnique({ where: { id }, select: { status: true } });
      if (!row || row.status !== "active") this.flaggedOrphans.delete(id);
    }
  }

  /**
   * Phase 2B — stuck merge-backs and orphaned step children of one fan-out
   * family. Covers both directions — reconciling the parent or any child
   * recovers the whole family.
   */
  async reconcileFamily(flow: FlowRow): Promise<void> {
    const parentId = flow.parentFlowId ?? flow.id;
    const stuck = await db.prisma.stepMerge.findMany({
      where: { parentFlowId: parentId, status: { in: ["running", "conflict", "rejected"] } },
      select: { id: true, flowId: true, parentFlowId: true, parentNode: true, status: true, updatedAt: true },
    });
    for (const row of stuck) {
      try {
        await this.reconcileStepMerge(row);
      } catch (e: unknown) {
        await db.emitEvent(parentId, null, "error",
          `reconcile: step merge ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (flow.parentFlowId == null) await this.reconcileOrphanChildren(flow.id);
  }

  private async reconcileStepMerge(row: {
    id: string; flowId: string; parentFlowId: string; parentNode: string; status: string; updatedAt: Date;
  }): Promise<void> {
    const failLoud = async (reason: string): Promise<void> => {
      await db.prisma.stepMerge.updateMany({
        where: { id: row.id, status: { in: ["running", "conflict", "rejected"] } },
        data: { status: "failed", error: reason.slice(0, 2000), updatedAt: new Date() },
      });
      await db.emitEvent(row.parentFlowId, null, "error",
        `step merge-back on "${row.parentNode}" was interrupted: ${reason}`,
        { nodeKey: row.parentNode, childFlowId: row.flowId, mergeId: row.id });
    };
    if (mergeArena.isMerging(row.flowId)) return; // alive in this process — nothing to flag
    // freshness guard: an attempt this process just re-booked stamps the row —
    // give a re-booked merge the same grace the merge-fix budget allows
    const updatedMs = row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(String(row.updatedAt));
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs < STEP_MERGE_GRACE_MS) return;

    const parent = await db.prisma.flow.findUnique({ where: { id: row.parentFlowId }, select: { id: true, status: true } });
    const child = await db.prisma.flow.findUnique({
      where: { id: row.flowId },
      select: { id: true, parentFlowId: true, status: true },
    });
    if (!parent || !child || child.parentFlowId !== row.parentFlowId) {
      await failLoud("the step child or its parent flow row is gone (orphaned merge-back)");
      return;
    }
    const step = await db.prisma.planStep.findFirst({
      where: { subFlowId: row.flowId },
      select: { id: true, title: true, status: true },
    });
    if (!step) {
      await failLoud("the plan step ⇄ sub-flow linkage is gone (orphaned merge-back)");
      return;
    }
    const parentNodeId = await engineParts.nodeStore.idOf(row.parentFlowId, row.parentNode);
    if (!parentNodeId) {
      await failLoud(`the parent fan-out node "${row.parentNode}" no longer exists (orphaned merge-back)`);
      return;
    }
    if (child.status !== "active") {
      await failLoud(`the step child is ${child.status} but its merge never landed`);
      return;
    }
    const childNode = await db.prisma.node.findFirst({
      where: { flowId: row.flowId, nodeKey: await stepFlows.childWorkNodeKey(row.flowId) },
      select: { status: true },
    });
    if (!childNode) {
      await failLoud("the step child has no work node (the fan-out linkage is broken)");
      return;
    }
    if (childNode.status === "running") {
      // a merge-fix agent run was mid-flight at the restart — the child's
      // nodes are durable, so the STANDARD node recovery decides recovered vs
      // failed (delegated to the owning Reconciler's walk)
      const childFlow = await db.prisma.flow.findUnique({
        where: { id: row.flowId },
        select: FLOW_SELECT,
      });
      if (childFlow && this.reconcileNodes) {
        await this.reconcileNodes(childFlow as unknown as FlowRow);
      }
      const after = (await db.prisma.node.findFirst({
        where: { flowId: row.flowId, nodeKey: await stepFlows.childWorkNodeKey(row.flowId) },
        select: { status: true },
      }))?.status;
      if (after === "awaiting_approval") await stepFlows.resumePendingMerge(row.flowId);
      return;
    }
    if (childNode.status !== "awaiting_approval") {
      await failLoud(`the step child node is ${childNode.status} (merge interrupted) — Retry the step to re-run the merge (+ fix agent)`);
      return;
    }
    // safe resume: the child is approved and unmerged — re-enter the bounded loop
    await stepFlows.resumePendingMerge(row.flowId);
  }

  /** Orphan step children: the linkage (or the whole parent node) is gone — flag once, leave inert. */
  private async reconcileOrphanChildren(parentFlowId: string): Promise<void> {
    const children = await db.prisma.flow.findMany({
      where: { parentFlowId, kind: "step" },
      select: { id: true, name: true, status: true },
    });
    for (const c of children) {
      if (await db.prisma.planStep.findFirst({ where: { subFlowId: c.id }, select: { id: true } })) continue;
      if (this.flaggedOrphans.has(c.id)) continue;
      this.flaggedOrphans.add(c.id);
      await db.emitEvent(parentFlowId, null, "error",
        `orphan step child "${c.name}" — its plan step no longer links to it (the step was removed or the flow re-planned); the child is inert and hidden from lists`,
        { childFlowId: c.id });
    }
  }

  /**
   * Global pass (worker boot): every parent with a stuck step_merges row
   * after a restart — resume or flag, including when nobody has opened a
   * flow page yet.
   */
  async sweepStuck(): Promise<void> {
    const parents = await db.prisma.stepMerge.findMany({
      where: { status: { in: ["running", "conflict", "rejected"] } },
      select: { parentFlowId: true },
      distinct: ["parentFlowId"],
    });
    for (const { parentFlowId: p } of parents) {
      const flow = await db.prisma.flow.findUnique({ where: { id: p }, select: FLOW_SELECT });
      if (!flow || flow.status !== "active") continue;
      try {
        await this.reconcileFamily(flow as unknown as FlowRow);
      } catch (e: unknown) {
        await db.emitEvent(p, null, "error", `reconcile: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
