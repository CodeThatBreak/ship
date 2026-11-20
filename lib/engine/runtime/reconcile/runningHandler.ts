import "server-only";

import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { FLOW_STATUS } from "../../../../constants/flow";
import { STEP_MERGE_GRACE_MS } from "./constants/reconcileTiming";
import { RecoveryDriver } from "./recoveryDriver";

/**
 * RunningHandler — the `running` row of the reconcile matrix
 * (target-architecture §9, Invariant 3): a running node is alive while its
 * lease (`lease_until > now()`, DB-server time) is current; the walker only
 * hands this handler nodes whose lease expired or is missing (missing lease
 * on a running node IS expired — fail loud, no legacy backfill).
 *
 * Orchestration waits that legitimately outlive any heartbeat loop are
 * verified against durable state before recovery runs:
 *  - fan-out/split aggregates park `running` while child flows work — the
 *    child flows are the liveness evidence;
 *  - a step merge-back in flight keeps the aggregate's family fresh — the
 *    `step_merges` row's recency is the evidence (bounded by the merge-fix
 *    budget; the merge arena's own recovery flags a truly stuck one).
 *
 * Must never: compare a lease against app-server time, fail a node whose
 * children are actively working, or throw (the driver owns failure mapping).
 */
export class RunningHandler {
  constructor(private readonly recovery: RecoveryDriver) {}

  async handle(flow: FlowRow, node: { id: string; nodeKey: string }): Promise<void> {
    if (await this.flowHasActiveChildren(flow.id)) return;
    if (await this.mergeInFlight(flow.id)) return;
    await this.recovery.recover(flow, node);
  }

  /** Any active step/split child flow ⇒ a fan-out/split aggregate is mid-run. */
  private async flowHasActiveChildren(flowId: string): Promise<boolean> {
    const child = await db.prisma.flow.findFirst({
      where: { parentFlowId: flowId, status: FLOW_STATUS.ACTIVE },
      select: { id: true },
    });
    return child !== null;
  }

  /**
   * A step merge-back executing in another process: the family's
   * `step_merges` row is stamped by each attempt — fresh means alive. The
   * in-process guard (`mergeArena.isMerging`) lives in StepMergeRecovery,
   * which owns that domain; this check must stay durable-state-only.
   *
   * Contained raw (target-architecture §9, Invariant 3): the staleness
   * window is `updated_at > now() - make_interval(secs => $n)` — interval
   * arithmetic against DB-server time; Prisma has no equivalent.
   */
  private async mergeInFlight(flowId: string): Promise<boolean> {
    return Boolean(await db.get(
      `SELECT 1 FROM step_merges
       WHERE parent_flow_id=$1 AND status IN ('running','conflict','rejected')
         AND updated_at > now() - make_interval(secs => $2)
       LIMIT 1`,
      flowId,
      STEP_MERGE_GRACE_MS / 1000,
    ));
  }
}
