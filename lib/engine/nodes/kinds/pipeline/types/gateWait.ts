import "server-only";

import type { NodeRow } from "../../../../../db/rows";
import type { FlowCtx, RunOutcome } from "../../../shared/nodeSharedExports";
import type { PipelineInput } from "../schema";
import type { GateProgress } from "./gateProgress";

/** One wait-loop drive: the flow/node context, the recorded input/config, and
 *  the progress snapshot the loop mutates (fresh or resumed) + the def's ONE
 *  outcome publication path. */
export interface GateWaitArgs {
  readonly ctx: FlowCtx;
  readonly node: NodeRow;
  readonly input: PipelineInput;
  readonly config: Record<string, unknown>;
  readonly label: string;
  /** initial progress — a fresh snapshot (run) or the durable one (recover) */
  readonly progress: GateProgress;
  /** the def's ONE outcome publication path (the transition authority's
   *  applyOutcome — status + validated output in one attempt-fenced write) */
  readonly finish: (outcome: RunOutcome) => Promise<RunOutcome>;
}

/** Injectable timing (constructor params) so tests drive the loop in
 *  milliseconds instead of the minute-scale config defaults (step 05). */
export interface GateWaitTiming {
  readonly pollMs?: number;
  readonly timeoutMin?: number;
}
