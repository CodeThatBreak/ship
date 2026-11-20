import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import { FlowRow } from "../../../db/rows";
import type { PlanStepRow } from "../planStepStore/types/planStep";
import { toRow } from "../planStepStore/utils/toPlanStepRow";
import { parseRow } from "./utils/ormRows";
import { worktreeManager } from "../worktreeLifecycle";
import type { StepChildPayload } from "./types/stepChildPayload";

/**
 * StepChildStore — the fan-out runtime's shared child-row data access (step 07
 * decomposition of `StepFlowManager`): every read of a step child's flow row,
 * work node, trigger payload, merged outputs, plan-step link and merge row,
 * plus the child-close terminal, in one place. The expander, scheduler, rollup
 * and merge-back coordinator all read children through this store so a child's
 * shape is derived exactly one way.
 *
 * Invariants upheld:
 * - The child payload (`flows.trigger_payload`) is the fan-out linkage truth —
 *   `parentNodeKey` says which parent node a child belongs to; a payload
 *   without it is treated as "no fan-out linkage" (null), never guessed.
 * - The work node key prefers the expand-time payload (`workNodeKey`) and only
 *   falls back to the flow's first node for legacy children.
 *
 * Must never:
 * - write `nodes.status` (the transition authority's sole write) or publish
 *   transitions — it only closes the child FLOW row (`closeChild`, the
 *   standard `done` terminal that keeps rows for the audit trail);
 * - decide scheduling, rollup or merge policy — it is data access only.
 */
export class StepChildStore {
  /** The work node instance key for a step child (from expand-time payload, with legacy fallback). */
  async childWorkNodeKey(childFlowId: string): Promise<string> {
    const payload = await this.childPayload(childFlowId);
    if (payload?.workNodeKey) return payload.workNodeKey;
    const row = await db.prisma.node.findFirst({
      where: { flowId: childFlowId },
      orderBy: { createdAt: "asc" },
      select: { nodeKey: true },
    });
    if (!row) throw new Error("the step child has no nodes");
    return row.nodeKey;
  }

  async childTypeOf(childFlowId: string): Promise<string> {
    const workNodeKey = await this.childWorkNodeKey(childFlowId);
    const row = await db.prisma.node.findUnique({
      where: { flowId_nodeKey: { flowId: childFlowId, nodeKey: workNodeKey } },
      select: { type: true },
    });
    return row?.type ?? "";
  }

  async childFlowOf(childFlowId: string): Promise<FlowRow | undefined> {
    const row = await db.prisma.flow.findUnique({ where: { id: childFlowId } });
    return row ? parseRow(FlowRow, row) : undefined;
  }

  async childFlowStatus(childFlowId: string): Promise<string> {
    const row = await db.prisma.flow.findUnique({ where: { id: childFlowId }, select: { status: true } });
    return row?.status ?? "";
  }

  async stepRowOf(childFlowId: string): Promise<PlanStepRow | undefined> {
    const row = await db.prisma.planStep.findFirst({ where: { subFlowId: childFlowId } });
    return row ? toRow(row) : undefined;
  }

  /** The child flow's persisted trigger payload (parsed; null when absent/unparseable). */
  async childPayload(childFlowId: string): Promise<StepChildPayload | null> {
    const row = await db.prisma.flow.findUnique({
      where: { id: childFlowId },
      select: { triggerPayload: true },
    });
    const raw: unknown = row?.triggerPayload;
    if (raw == null) return null;
    try {
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as StepChildPayload;
      return parsed && typeof parsed === "object" && parsed.parentNodeKey ? parsed : null;
    } catch {
      return null;
    }
  }

  /** The child's merged node outputs (last write wins per key). */
  async childOutput(childFlowId: string): Promise<Record<string, unknown> | null> {
    const outs = await db.prisma.node.findMany({
      where: { flowId: childFlowId },
      orderBy: { updatedAt: "asc" },
      select: { output: true },
    });
    const merged: Record<string, unknown> = {};
    let any = false;
    for (const row of outs) {
      const output: unknown = row.output;
      if (output == null) continue;
      try {
        const parsed = typeof output === "string" ? JSON.parse(output) : output;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(merged, parsed);
          any = true;
        } else if (parsed != null) {
          merged.markdown = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          any = true;
        }
      } catch { /* unparseable output column — skipped */ }
    }
    return any ? merged : null;
  }

  /** The latest step_merges row for a child (null = never merged/attempts). */
  async latestMergeRow(childFlowId: string): Promise<{ status: string; attempts: number; error: string | null } | null> {
    return (await db.prisma.stepMerge.findFirst({
      where: { flowId: childFlowId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, attempts: true, error: true },
    })) ?? null;
  }

  /** Close a child flow (standard terminal state; keeps rows for the audit trail).
   *  `tx` joins the caller's completion batch — the worktree sweep (I/O) stays outside. */
  async closeChild(childFlowId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? db.prisma).flow.updateMany({
      where: { id: childFlowId, status: { not: "done" } },
      data: { status: "done", updatedAt: new Date() },
    });
    // child worktree sweep on terminal (Phase 2C): the local-mode child's
    // per-step worktree is transient — removed now, not on the next startup
    // sweep. `deleteBranch:false`: the branch ref lives in the hub, so a later
    // node retry still rebuilds the worktree from its own branch; the
    // startup sweep covers any removal a crash interrupted (crash-safe
    // worktree_removals rows are keyed by flow id — child ids work as-is).
    void worktreeManager.removeFlowWorktree(childFlowId, { reason: "step child resolved" })
      .catch(() => { /* the startup sweep resumes */ });
  }
}
