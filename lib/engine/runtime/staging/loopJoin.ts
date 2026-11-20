import "server-only";

import { NODE_STATUS } from "../../constants/nodeStatus";
import { isNodeTerminalSuccess } from "../transitions/constants/statusSets";
import type { StageRunnerHost } from "../flowEngineHost";
import type { LoopJoinDescriptor, LoopJoinGraph } from "./types/loopJoin";
/**
 * LoopJoin — the declared loop-edge re-entry join (step 07 task 5,
 * Invariant 8's join half). When a loop edge's `when` condition activates the
 * edge, the join resets the target to `pending`, then every downstream node
 * along `next` edges that already holds a resettable status — the re-entry
 * rerun path (e.g. resolve → gate → review → resolve). The reset set comes
 * from the declared descriptor, not an ad-hoc predicate.
 *
 * Invariants: only statuses the descriptor's `resets` set declares are
 * touched — nodes held elsewhere (pending/waiting/running/failed/
 * awaiting_approval) are never reset; every reset is a declared transition
 * (`loopReentry`) through the authority, never a raw status write.
 *
 * Must never: activate a loop edge itself (the ConditionEvaluator owns edge
 * activation — a condition-less loop edge stays display metadata), or reset
 * a node the descriptor does not declare.
 */
export class LoopJoin {
  constructor(private readonly host: StageRunnerHost) {}

  /**
   * Fire the join for an activated loop edge: reset the target and its
   * downstream resettable nodes per the descriptor. The edge's `when` has
   * already evaluated truthy — the descriptor carries it for the join's
   * contract (and future per-edge overrides), not for re-evaluation.
   */
  async enter(flowId: string, g: LoopJoinGraph, key: string, descriptor: LoopJoinDescriptor): Promise<void> {
    const queue = [key];
    const seen = new Set(queue);
    while (queue.length) {
      const k = queue.shift();
      if (k === undefined) break;
      const st = await this.host.nodeStatus(flowId, k);
      if (this.resettable(st ?? "", descriptor)) {
        await this.host.setNodeStatus(flowId, k, "loopReentry");
        for (const e of g.edges.filter((e) => e.kind === "next" && e.from === k)) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            queue.push(e.to);
          }
        }
      }
    }
  }

    /** The statuses the descriptor's declared reset set clears. */
  private resettable(s: string, descriptor: LoopJoinDescriptor): boolean {
    return (descriptor.resets.SUCCESS_TERMINALS && isNodeTerminalSuccess(s))
      || (descriptor.resets.SKIPPED_BRANCHES && s === NODE_STATUS.SKIPPED);
  }
}
