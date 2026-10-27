import type { FlowData } from "@/types/flow";
import { FANOUT_STATE, FLOW_STATUS, type FanoutState } from "@/constants/flow";

/**
 * Plan fan-out (Phase 1D): the per-node step rollup for the graph subtitle —
 * `steps 3/8 · building` style, keyed by the fan-out node instance key.
 * Derived purely from the plan steps' attached child sub-flow state; nodes
 * that never fanned out have no entry.
 *
 * Phase 4 additions (monitoring): `costCents` rolls the children's billed
 * runs up for the subtitle (`· $0.42`) and `state` is the AGGREGATE child
 * state driving the parent card's badge colors — the node's own status stays
 * `running` while it orchestrates, so the red/failure and final-approval
 * signals come from the children, not the orchestrator row:
 * - `failed`     — any child failed (not yet resolved) → red
 * - `awaiting`   — children pending per-step approval → warning
 * - `in-flight`  — children still building → info
 * - `resolved`   — every child terminal, final approval pending → success
 */
export type FanoutProgress = {
  total: number;
  done: number;
  running: string | null;
  costCents: number;
  state: FanoutState;
};

export function fanoutProgressOf(
  flow: FlowData,
): Record<string, FanoutProgress> {
  const out: Record<string, FanoutProgress> = {};
  for (const s of flow.planSteps ?? []) {
    const sf = s.sub_flow;
    if (!sf?.parentNodeKey) continue;
    const e = (out[sf.parentNodeKey] ??= {
      total: 0,
      done: 0,
      running: null,
      costCents: 0,
      state: FANOUT_STATE.RESOLVED,
    });
    e.total++;
    e.costCents += sf.costCents ?? 0;
    const failed =
      sf.nodeStatus === FLOW_STATUS.FAILED ||
      (sf.mergeStatus && sf.mergeStatus !== "merged" && s.status !== FLOW_STATUS.DONE);
    const resolved =
      s.status === FLOW_STATUS.DONE || sf.status === FLOW_STATUS.DONE || s.completed_by === "skipped";
    if (resolved) e.done++;
    else if (failed) e.state = FANOUT_STATE.FAILED;
    else {
      if (sf.nodeStatus === FLOW_STATUS.AWAITING_APPROVAL) {
        e.state = e.state === FANOUT_STATE.FAILED ? e.state : FANOUT_STATE.AWAITING;
        e.running = e.running ?? "awaiting approval";
      } else if (sf.nodeStatus === FLOW_STATUS.RUNNING) {
        if (e.state !== FANOUT_STATE.FAILED && e.state !== FANOUT_STATE.AWAITING) e.state = FANOUT_STATE.IN_FLIGHT;
        e.running = e.running ?? "building";
      } else if (e.state === FANOUT_STATE.RESOLVED) e.state = FANOUT_STATE.IN_FLIGHT; // pending / no run yet
    }
  }
  return out;
}
