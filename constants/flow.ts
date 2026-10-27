/**
 * Flow-domain status values (§2.7): every status literal the UI compares
 * against the flow engine's snapshot, in one named set. The engine's row
 * (`Node.status`, `BranchRow.status`, `FlowData.status`) is a free string on
 * the wire — this is the UI's closed vocabulary for it, grouped by the field
 * each value belongs to.
 *
 * - Flow-level: `active` — a flow that is not finished/archived.
 * - Node / branch build statuses: the run-state machine shared by nodes
 *   (`Node.status`, `PlanStepRow.sub_flow.nodeStatus`) and MR branches
 *   (`BranchRow.status`).
 */
export const FLOW_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  AWAITING_APPROVAL: "awaiting_approval",
  APPROVED: "approved",
  DONE: "done",
  FAILED: "failed",
  /** node eligible but its event source hasn't delivered yet (wait_for) */
  WAITING: "waiting",
  /** non-taken branches / skipped steps */
  SKIPPED: "skipped",
  /** branch status only: the step build is running on the branch */
  BUILDING: "building",
  /** flow status only: the flow is live */
  ACTIVE: "active",
} as const;

export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];

/**
 * The final statuses a finished node run can persist (the engine's
 * `RunOutcome.status`, §T5/F11). Derived from `FLOW_STATUS` — the values have
 * exactly one home; this is the closed vocabulary the engine's run outcomes
 * are checked against at compile time.
 */
export const NODE_RUN_STATUS = {
  AWAITING_APPROVAL: FLOW_STATUS.AWAITING_APPROVAL,
  DONE: FLOW_STATUS.DONE,
  FAILED: FLOW_STATUS.FAILED,
} as const;

export type NodeRunStatus = (typeof NODE_RUN_STATUS)[keyof typeof NODE_RUN_STATUS];

/** Plan fan-out aggregate child state (Phase 4 monitoring, §5): the node's
 *  own status stays `running` while it orchestrates, so the per-step rollup
 *  is an AGGREGATE over the children — see `components/flows/cockpit/fanout-progress.ts`. */
export const FANOUT_STATE = {
  FAILED: "failed",
  AWAITING: "awaiting",
  IN_FLIGHT: "in-flight",
  RESOLVED: "resolved",
} as const;

export type FanoutState = (typeof FANOUT_STATE)[keyof typeof FANOUT_STATE];

/** Badge color per run status — the one statusVariant lookup the panels,
 *  graph nodes and plan header share. Unlisted statuses render muted
 *  (undefined) — `failed` intentionally carries only the `destructive`
 *  variant (callers pair it with `isFailedStatus`). */
export const STATUS_VARIANT: Partial<Record<FlowStatus, string>> = {
  [FLOW_STATUS.APPROVED]: "bg-success/10 text-success",
  [FLOW_STATUS.DONE]: "bg-success/10 text-success",
  [FLOW_STATUS.RUNNING]: "bg-info/10 text-info",
  [FLOW_STATUS.BUILDING]: "bg-info/10 text-info",
  [FLOW_STATUS.AWAITING_APPROVAL]: "bg-warning/10 text-warning",
};

/** The badge color for a status (muted when the status has no color). */
export function statusVariantOf(status: string): string | undefined {
  return STATUS_VARIANT[status as FlowStatus];
}

/** The node reached a terminal, accepted state (done or approved). */
export function isTerminalFlowStatus(status: string): boolean {
  return status === FLOW_STATUS.DONE || status === FLOW_STATUS.APPROVED;
}

/** Boolean component-pair helper: the failed badge variant, else undefined. */
export function isFailedStatus(status: string): boolean {
  return status === FLOW_STATUS.FAILED;
}
