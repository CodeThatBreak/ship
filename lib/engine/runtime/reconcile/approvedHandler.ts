import "server-only";

import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { nodeRegistry } from "../../nodes/registry";
import { templateStore } from "../../templates/templateStore";
import { JOB_KIND } from "../jobs/constants/jobVocabulary";
import type { TransitionAuthority } from "../transitions/nodeTransitions";
import type { TransitionEvents } from "../transitions/transitionEvents";

/**
 * ApprovedHandler — the `approved` (build) row of the reconcile matrix
 * (Invariant 3): a build approved by the user whose MR never materialized
 * (creation crashed or was interrupted) is a reconciler-VISIBLE stuck state.
 * Today's fix is the declared revert — `mrHandback` back to
 * `awaiting_approval` with an event, so the user re-approves and the MR
 * creation runs again. Adopt/recreate of the interrupted MR lands with the
 * effect layer (step 07), which owns "what happens after approval".
 *
 * Scope guard: only MR-producing nodes (the SDLC build — `chainRole` BUILD).
 * Plan nodes and branch-choice nodes also rest in `approved` legitimately
 * while the flow continues; reverting those would break live flows.
 *
 * Must never: revert a node whose flow HAS an MR (branch or flow level),
 * revert while a live `mr_create` job exists (step 06 task 5 — the journal
 * owns the interrupted creation; the re-claim's adopt path lands the MR), or
 * treat a non-build approved node as MR-less stuck state.
 */
export class ApprovedHandler {
  constructor(
    private readonly transitions: TransitionAuthority,
    private readonly events: TransitionEvents,
  ) {}

  async handle(flow: FlowRow, node: { nodeKey: string }): Promise<void> {
    const isBuild = await this.isMrProducingNode(flow.id, node.nodeKey);
    if (!isBuild) return;
    if (await this.flowHasMergeRequest(flow)) return;
    // step 06 task 5: a live `mr_create` job owns this flow's MR creation —
    // the journal (its re-claim's adopt path), not this revert, finishes an
    // interrupted creation. Only a truly job-less approved build reverts.
    if (await this.hasLiveMrCreateJob(flow.id)) return;
    const applied = await this.transitions.apply(flow.id, node.nodeKey, "mrHandback");
    if (!applied) return;
    await this.events.error(
      flow.id,
      node.nodeKey,
      `${node.nodeKey} was approved but no MR exists (creation was interrupted) — reverted to awaiting approval; approve again to create the MR`,
    );
  }

  private async isMrProducingNode(flowId: string, nodeKey: string): Promise<boolean> {
    const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
    const def = spec?.defKey ? nodeRegistry.maybe(spec.defKey) : nodeRegistry.maybe(nodeKey);
    return def?.chainRole === NODE_KEYS.BUILD;
  }

  private async flowHasMergeRequest(flow: FlowRow): Promise<boolean> {
    if (flow.mrIid != null) return true;
    const branch = await db.prisma.branch.findFirst({
      where: { flowId: flow.id, mrIid: { not: null } },
      select: { id: true },
    });
    return branch !== null;
  }

  /** A live `mr_create` job: queued, or claimed with an unexpired lease
   *  (a claimed job whose lease lapsed is the sweep's to re-claim).
   *
   *  Contained raw (target-architecture §8, Invariant 7 — the jobs clock
   *  rule): lease liveness compares against DB-server time
   *  (`lease_until > now()`), which Prisma's query API cannot express. */
  private async hasLiveMrCreateJob(flowId: string): Promise<boolean> {
    return Boolean((
      await db.prisma.$queryRawUnsafe<{ ok: number }[]>(
        `SELECT 1 AS ok FROM jobs WHERE flow_id=$1 AND kind=$2
         AND (status='queued' OR (status='claimed' AND lease_until > now()))
       LIMIT 1`,
        flowId,
        JOB_KIND.MR_CREATE,
      )
    )[0]);
  }
}
