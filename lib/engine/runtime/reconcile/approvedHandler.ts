import "server-only";

import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { nodeRegistry } from "../../nodes/registry";
import { templateStore } from "../../templates/templateStore";
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
 * Must never: revert a node whose flow HAS an MR (branch or flow level), or
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
    return Boolean(await db.get(
      `SELECT 1 FROM branches WHERE flow_id=$1 AND mr_iid IS NOT NULL LIMIT 1`,
      flow.id,
    ));
  }
}
