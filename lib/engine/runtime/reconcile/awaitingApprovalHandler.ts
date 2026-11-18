import "server-only";

import type { FlowRow } from "../../../db/rows";
import type { TransitionAuthority } from "../transitions/nodeTransitions";
import type { TransitionEvents } from "../transitions/transitionEvents";
import { deadUpstreamKey } from "./utils/deadUpstream";

/**
 * AwaitingApprovalHandler — the `awaiting_approval` row of the reconcile
 * matrix: a node parked for the user is invisible to liveness, but a dead
 * upstream makes the approval pointless — fail it loudly with a typed event
 * so the UI stops showing a live approval on a dead branch.
 *
 * Must never: write status directly (the `cancel` transition through the
 * authority owns the failure) or fire transitions for an alive upstream.
 */
export class AwaitingApprovalHandler {
  constructor(
    private readonly transitions: TransitionAuthority,
    private readonly events: TransitionEvents,
  ) {}

  async handle(flow: FlowRow, node: { nodeKey: string }): Promise<void> {
    const deadUpstream = await deadUpstreamKey(flow.id, node.nodeKey);
    if (!deadUpstream) return;
    const applied = await this.transitions.apply(flow.id, node.nodeKey, "cancel");
    if (applied) {
      await this.events.error(
        flow.id,
        node.nodeKey,
        `${node.nodeKey}: upstream ${deadUpstream} failed before the approval was used — retry ${deadUpstream} to continue`,
      );
    }
  }
}
