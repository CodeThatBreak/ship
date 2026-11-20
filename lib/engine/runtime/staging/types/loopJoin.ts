import "server-only";

import type { TemplateGraph } from "../../../templates/templateStore";
import type { LOOP_JOIN_RESETS } from "../constants/loopJoin";

/**
 * The join descriptor a loop edge carries into the LoopJoin (step 07 task 5):
 * `when` is the edge's lint-checked condition (already evaluated true when the
 * join fires); `resets` is the declared reset set the LoopJoin interprets —
 * never ad-hoc status writes.
 */
export interface LoopJoinDescriptor {
  when: string | null;
  resets: typeof LOOP_JOIN_RESETS;
}

/** The graph context the LoopJoin walks (the target plus its `next` downstream). */
export type LoopJoinGraph = Pick<TemplateGraph, "edges">;
