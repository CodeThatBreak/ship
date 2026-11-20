import "server-only";

import { db } from "../../../db/app";
import { NODE_LEASE_SECONDS } from "../../constants/leases";

/**
 * WorktreeActivity — lifecycle-event attribution and the warm-up lease
 * heartbeat for the worktree lifecycle (engine §1 runtime services; supports
 * Invariant 2 — liveness is `lease_until > now()`).
 *
 * Invariants:
 * - Events routed to a node carry the node's `node_key`, never the row id
 *   (the activity feed joins on nodeKey).
 * - Every ensure-step activity extends the attributed node's lease, because a
 *   first-checkout ensure (`git worktree add` + bounded deps copy) runs for
 *   minutes with no agent run row yet — without the heartbeat the reconciler
 *   fails the live node once the claim's initial lease budget lapses.
 *
 * Must-never: never stamp a stranger's node — nodeKey is resolved from the
 * flow's own rows only; never emit a lease heartbeat without node
 * attribution (flow-level events must not extend arbitrary leases).
 */
export class WorktreeActivity {
  /** Resolve feed routing key from a node row id (never use the row id as nodeKey). */
  async nodeKeyFor(flowId: string, nodeId: string | null | undefined): Promise<string | undefined> {
    if (!nodeId) return undefined;
    const row = await db.prisma.node.findFirst({ where: { id: nodeId, flowId }, select: { nodeKey: true } });
    return row?.nodeKey;
  }

  async lifecycleData(
    flowId: string,
    nodeId: string | null | undefined,
    extra?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const nodeKey = await this.nodeKeyFor(flowId, nodeId);
    if (!nodeKey && !extra) return undefined;
    return { ...(extra ?? {}), ...(nodeKey ? { nodeKey } : {}) };
  }

  /**
   * Warm-up lease heartbeat: extend the attributed node's `lease_until` each
   * time an ensure step emits activity. A first-checkout ensure (`git worktree
   * add` + the bounded deps copy) runs for minutes with no agent run row yet,
   * and the reconciler's liveness test is `lease_until > now()` (step 03,
   * Invariant 2) — without these extensions the reconciler fails the live
   * node once the claim's initial lease budget lapses.
   */
  async touchNode(flowId: string, nodeId: string | null | undefined): Promise<void> {
    if (!nodeId) return;
    await this.stampNodeLease(flowId, nodeId);
  }

  /**
   * Lease invariant (step 03, Invariant 2): a live node satisfies
   * `nodes.lease_until > now()` evaluated on the DB-server clock. The stamp is
   * interval arithmetic on DB time (`now() + make_interval`) — kept raw like
   * every other lease stamp (nodeSupport's stampNodeLease/stampRunLease,
   * jobQueue's claims), never app-server `Date.now()`. Raw-SQL containment
   * list (same rule as `lib/engine/runtime/jobs/jobQueue.ts`): this file is on
   * the containment list the Task 12 lint rule allowlists. The `flow_id`
   * guard keeps the never-stamp-a-stranger's-node invariant.
   */
  private async stampNodeLease(flowId: string, nodeId: string): Promise<void> {
    await db.prisma.$executeRawUnsafe(
      `UPDATE nodes SET lease_until = now() + make_interval(secs => $1) WHERE id=$2 AND flow_id=$3`,
      NODE_LEASE_SECONDS,
      nodeId,
      flowId,
    );
  }
}
