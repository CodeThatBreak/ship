import "server-only";

import type { PlanStepRow } from "../../planStepStore";

/** Live state of one step child, derived from plan_steps + the child flow. */
export interface StepState {
  step: PlanStepRow;
  childFlowId: string | null;
  childStatus: string | null; // flows.status of the child ('done' when closed)
  childNodeKey: string | null;
  childNodeType: string | null;
  /** rolled-up child node status: failed > awaiting_approval > running > done (> null = no run yet) */
  childNodeStatus: string | null;
  /** the child's own step branch (code children only; from flows.mrBranch) */
  branch: string | null;
  /** the parent-side integration branch the child merges into (code children only) */
  integrationBranch: string | null;
  isCodeChild: boolean;
  isRunning: boolean; // node running
  isAwaiting: boolean; // node awaiting_approval (counts as in flight)
  isResolved: boolean; // done/approved/skipped/failed — terminal for the rollup
  isFailed: boolean; // FAILED-visible: failed node or a non-merged step_merges row
  /** durable merge-back state (Phase 2): latest step_merges row status for the child (null = never merged) */
  mergeStatus: string | null;
  /** merge-fix attempts consumed so far on that row */
  mergeAttempts: number;
  /** last merge-back error text (conflict detail / hook rejection / infra) */
  mergeError: string | null;
  /**
   * True when this code child's step branch diverges from its integration
   * branch's head (an earlier sibling already merged onto it — the branch was
   * cut at expand time so it cannot contain the new head). The merge repairs
   * it with a merge commit (never a rebase); the parent card shows the
   * stale-base chip while it diverges.
   */
  staleBase: boolean;
}
