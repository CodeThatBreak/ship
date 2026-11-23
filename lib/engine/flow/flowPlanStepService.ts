import "server-only";

import { db } from "../../db/app";
import { NODE_KEYS } from "../constants/nodeKeys";
import { NODE_STATUS } from "../constants/nodeStatus";
import { planSteps } from "../runtime/planStepStore";
import type { PlanStepInput } from "../runtime/planStepStore/types/planStep";
import type { FlowPlanStepHost } from "./types/flowPlanStepHost";

/**
 * FlowPlanStepService — the structured plan-checklist editing paths carved
 * out of the FlowEngine facade (step 06 size repair, the step-05 `flow/`
 * service pattern): bulk-replacing the checklist from the Plan view editor
 * and toggling one step's status.
 *
 * Must never: edit steps while a run is in flight (the in-flight guard reads
 * node statuses — Q5: `current_node` is gone), or write node status (the plan
 * node's status belongs to the transition authority).
 */
export class FlowPlanStepService {
  constructor(private readonly host: FlowPlanStepHost) {}

  private async assertPlanEditable(flowId: string) {
    // derive the in-flight run from node statuses (Q5: current_node is gone)
    const running = await db.prisma.node.findFirst({
      where: { flowId, status: NODE_STATUS.RUNNING },
      select: { nodeKey: true },
    });
    if (running) throw new Error(`wait for the ${running.nodeKey} run to finish before editing steps`);
    return this.host.latestResourceArtifact<{ id: string }>(flowId, NODE_KEYS.PLAN);
  }

  /** Bulk-replace the checklist from the Plan view editor. The editor sends
   *  each row's plan-step row id (PlanSteps payload), so a harmless
   *  title/detail/files edit keeps its row instead of being read as a
   *  remove + re-add. */
  async updatePlanSteps(flowId: string, input: PlanStepInput[]): Promise<void> {
    if (!Array.isArray(input) || input.some(s => !s?.title?.trim?.())) {
      throw new Error('steps must be an array of {title, detail?, files?}');
    }
    const latestPlan = await this.assertPlanEditable(flowId);
    const existing = await planSteps.list(flowId);
    const byId = new Map(existing.map(s => [s.id, s]));
    const claimed = new Set<string>(); // existing rows matched to a kept input row
    const matched = new Map<number, string>(); // input index → existing row id
    for (const [i, row] of input.entries()) {
      const sentId = typeof row.id === 'string' ? row.id.trim() : '';
      const m = sentId ? byId.get(sentId) : undefined;
      if (m && !claimed.has(m.id)) {
        claimed.add(m.id);
        matched.set(i, m.id);
      }
    }
    const updated = await planSteps.replace(
      flowId,
      latestPlan?.id ?? null,
      input.map(s => ({ title: s.title.trim(), detail: s.detail, files: s.files, branch: s.branch })),
      { matchedRows: matched }
    );
    await this.host.emitLifecycle(flowId, null, `plan checklist edited (${updated.length} steps)`, {
      // route the event to the tab that owns the checklist (§3.3 — stamped at
      // emit time; the feed no longer guesses from message text)
      nodeKey: (await this.host.keyOfRole(flowId, NODE_KEYS.PLAN)) ?? undefined,
    });
    await this.touch(flowId);
  }

  /** Toggle one step done/pending. */
  async setPlanStepStatus(flowId: string, stepId: string, status: 'pending' | 'done'): Promise<void> {
    if (status !== 'pending' && status !== 'done') throw new Error('status must be pending|done');
    if (!(await planSteps.setStatus(flowId, stepId, status, 'manual'))) throw new Error('step not found');
    await this.touch(flowId);
  }

  private async touch(flowId: string): Promise<void> {
    // updateMany keeps the raw write's no-op-on-missing-row semantics
    await db.prisma.flow.updateMany({ where: { id: flowId }, data: { updatedAt: new Date() } });
  }
}
