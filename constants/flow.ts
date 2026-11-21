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

/**
 * Flow-node action names (§2.7): the client's wire vocabulary for the flow
 * action route's dispatch (`app/api/flows/[id]/action/route.ts`).
 */
export const FLOW_ACTION = {
  APPROVE_PLAN: "approve_plan",
  UPDATE_PLAN_STEPS: "update_plan_steps",
  SET_PLAN_STEP: "set_plan_step",
  APPROVE_BUILD: "approve_build",
  PIPELINE: "pipeline",
  RESOLVE: "resolve",
  REVIEW: "review",
  RETRY: "retry",
  CANCEL: "cancel",
  RUN_NODE: "run_node",
  APPROVE_NODE: "approve_node",
  SET_NODE_CONFIG: "set_node_config",
  CHOOSE_NODE: "choose_node",
  APPROVE_FANOUT_STEP: "approve_fanout_step",
  RETRY_FANOUT_STEP: "retry_fanout_step",
  SKIP_FANOUT_STEP: "skip_fanout_step",
  SKIP_SPLIT_UNIT: "skip_split_unit",
  RETRY_SPLIT_UNIT: "retry_split_unit",
  APPROVE_SPLIT_UNIT: "approve_split_unit",
  CANCEL_SPLIT_UNIT: "cancel_split_unit",
  /** Diff fact refresh (Task 08): re-run the read-only diff capture under the
   *  node's current state — the panel offers it when the branch moved past
   *  the capture. */
  REFRESH_DIFF: "refresh_diff",
  /** Panel "Open PR" (task 12): fire the declarative `create_change_request`
   *  verb directly — the same gateway-claimed action route the approval uses,
   *  without the approval hold. */
  CREATE_CHANGE_REQUEST: "create_change_request",
} as const;

export type FlowActionName = (typeof FLOW_ACTION)[keyof typeof FLOW_ACTION];

/**
 * The declarative effects config the generic panel reads to decide its verb
 * affordances (task 12): the client mirror of the engine's closed verb
 * vocabulary (`lib/engine/runtime/effects/constants/effectVerbs.ts`) — the
 * client never imports `lib/`. The effects declaration IS the capability
 * (design §4.2): no separate declarable capability vocabulary exists, so a
 * node whose config declares the verb under `afterApproval` may fire it
 * from the panel.
 */
export const DECLARED_EFFECTS = {
  CONFIG_KEY: "effects",
  AFTER_APPROVAL: "afterApproval",
  CREATE_CHANGE_REQUEST: "create_change_request",
} as const;

/**
 * The node statuses the panel's direct verb affordances offer — the client
 * mirror of the engine's `panelVerb` transition row's from-set (`lib/engine/
 * runtime/transitions/constants/transitionTable.ts`): a live run still owns
 * its branch, so the affordance hides for every non-terminal status (the
 * engine's fence would skip the trigger anyway).
 */
export const PANEL_VERB_STATUSES: readonly FlowStatus[] = [
  FLOW_STATUS.DONE,
  FLOW_STATUS.APPROVED,
  FLOW_STATUS.FAILED,
];

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
