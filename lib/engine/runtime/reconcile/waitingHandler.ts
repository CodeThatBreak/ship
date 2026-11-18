import "server-only";

import type { FlowRow } from "../../../db/rows";
import type { TransitionAuthority } from "../transitions/nodeTransitions";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { WaitStore } from "../waits/waitStore";
import { deadUpstreamKey } from "./utils/deadUpstream";

/**
 * WaitingHandler — the `waiting` rows of the reconcile matrix: an expired
 * durable wait (`wait_until` past) fires through the WaitStore (claim + run
 * in one owner), and a waiting node whose upstream died fails loudly with a
 * typed event instead of waiting forever. Webhook waits carry no deadline
 * (`wait_until` null) — only the dead-upstream check applies to them.
 *
 * Must never: write status directly (the `cancel` transition through the
 * authority owns the dead-upstream failure), fire a wait whose deadline has
 * not passed, or guess upstream health (the template graph's edges are the
 * only upstream source).
 */
export class WaitingHandler {
  constructor(
    private readonly transitions: TransitionAuthority,
    private readonly events: TransitionEvents,
    private readonly waits: WaitStore,
  ) {}

  async handle(flow: FlowRow, node: { nodeKey: string; waitDue: boolean }): Promise<void> {
    const deadUpstream = await deadUpstreamKey(flow.id, node.nodeKey);
    if (deadUpstream) {
      const applied = await this.transitions.apply(flow.id, node.nodeKey, "cancel");
      if (applied) {
        await this.events.error(
          flow.id,
          node.nodeKey,
          `${node.nodeKey}: upstream ${deadUpstream} failed while it was waiting — retry ${deadUpstream} to continue`,
        );
      }
      return;
    }
    if (!node.waitDue) return;
    // the durable sweep claims and fires in one owner (WaitStore.fire →
    // startNodeStage's resumeWait claim)
    await this.waits.sweepDueWaits(flow.id);
  }
}
