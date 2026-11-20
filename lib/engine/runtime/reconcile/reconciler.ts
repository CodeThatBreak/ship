import "server-only";

import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { engineParts } from "../../../composition/container";
import { flowEngine } from "../../flowEngine";
import { usageTracker } from "../../harness/usageTracker";
import type { TransitionAuthority } from "../transitions/nodeTransitions";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { WaitStore } from "../waits/waitStore";
import { ApprovedHandler } from "./approvedHandler";
import { AwaitingApprovalHandler } from "./awaitingApprovalHandler";
import { FLOW_SELECT } from "./constants/flowSelect";
import { RecoveryDriver } from "./recoveryDriver";
import { RunningHandler } from "./runningHandler";
import { StepMergeRecovery } from "./stepMergeRecovery";
import type { NodeStateView, RecoveryHost } from "./types/reconcile";
import { WaitingHandler } from "./waitingHandler";

/**
 * Reconciler v2 — walks EVERY non-terminal node state of a flow and drives
 * it toward terminal-or-actionable (Invariant 3, step 03): `running` with an
 * expired lease → recovery; `waiting` past its durable deadline → fire;
 * `waiting`/`awaiting_approval` with a dead upstream → failed + event;
 * `approved` build without an MR → revert to `awaiting_approval`. Then the
 * fan-out family pass (stuck step merges, orphan children).
 *
 * The pass is idempotent and cheap (lease/wait comparisons in SQL on
 * DB-server time), so it runs every worker tick and on flow open — the old
 * 20s per-flow throttle that let a crashed flow sit visibly stuck is gone.
 * No guessing: every branch verifies durable state first.
 *
 * Must never: write `nodes.status` outside the authority, compare a lease or
 * wait deadline against app-server time, or skip a non-terminal state (a new
 * status the matrix does not know about fails the walk loudly).
 */
export class Reconciler {
  private readonly running: RunningHandler;
  private readonly waiting: WaitingHandler;
  private readonly awaitingApproval: AwaitingApprovalHandler;
  private readonly approved: ApprovedHandler;
  private readonly stepMerges = new StepMergeRecovery();

  constructor(opts: {
    transitions?: TransitionAuthority;
    events?: TransitionEvents;
    waits?: WaitStore;
    host?: RecoveryHost;
  } = {}) {
    const transitions = opts.transitions ?? engineParts.transitions;
    const events = opts.events ?? engineParts.events;
    const recovery = new RecoveryDriver(opts.host ?? flowEngine);
    this.running = new RunningHandler(recovery);
    this.waiting = new WaitingHandler(transitions, events, opts.waits ?? flowEngine.waitsStore);
    this.awaitingApproval = new AwaitingApprovalHandler(transitions, events);
    this.approved = new ApprovedHandler(transitions, events);
    this.stepMerges.bind((flow) => this.reconcileNodeStates(flow));
  }

  /**
   * One idempotent pass over a flow's non-terminal nodes, then its fan-out
   * family. Safe under repeated invocation (conditional transitions +
   * claim-fenced recovery make every action a no-op on the second pass).
   */
  async reconcileFlow(flowId: string): Promise<void> {
    // legacy runs captured without cost (and stale estimates) get a cost from
    // our list-price calculation — once per process, non-blocking
    void usageTracker.backfillCosts().catch(() => {});
    const flow = await db.prisma.flow.findUnique({ where: { id: flowId }, select: FLOW_SELECT });
    if (!flow || flow.status !== "active") return;
    await this.reconcileNodeStates(flow as unknown as FlowRow);
    await this.stepMerges.reconcileFamily(flow as unknown as FlowRow);
  }

  /** Drop per-process dedup entries for flows that are gone or inactive. */
  async pruneFlowMaps(activeFlowIds: Set<string>): Promise<void> {
    await this.stepMerges.prune(activeFlowIds);
  }

  /** Worker-boot global pass over every stuck step_merges family. */
  async sweepStuckStepMerges(): Promise<void> {
    await this.stepMerges.sweepStuck();
  }

  /**
   * The state walk: one SQL select over the flow's non-terminal nodes with
   * the lease/wait due-flags computed on DB-server time, dispatched to the
   * per-status handlers. A node's handler error is contained (event + next
   * node) — one bad row never aborts the pass.
   */
  private async reconcileNodeStates(flow: FlowRow): Promise<void> {
    const nodes = await db.prisma.$queryRawUnsafe<NodeStateView[]>(
      `SELECT id, node_key AS "nodeKey", status, attempt_id AS "attemptId",
          (lease_until IS NULL OR lease_until <= now()) AS "leaseExpired",
          (wait_until IS NOT NULL AND wait_until <= now()) AS "waitDue"
       FROM nodes
       WHERE flow_id=$1 AND status IN ('running','waiting','awaiting_approval','approved')`,
      flow.id,
    );
    for (const node of nodes) {
      try {
        if (node.status === "running") {
          // the walker only surfaces running nodes whose lease lapsed —
          // lease-current ones never reach a handler
          if (node.leaseExpired) await this.running.handle(flow, node);
          continue;
        }
        if (node.status === "waiting") {
          await this.waiting.handle(flow, node);
          continue;
        }
        if (node.status === "awaiting_approval") {
          await this.awaitingApproval.handle(flow, node);
          continue;
        }
        if (node.status === "approved") {
          await this.approved.handle(flow, node);
        }
      } catch (e: unknown) {
        await db.emitEvent(
          flow.id, node.id, "error",
          `reconcile: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }
}
