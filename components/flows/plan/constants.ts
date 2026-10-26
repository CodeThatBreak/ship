/**
 * Plan-domain values (§2.7): mode/knob values, action names, and statuses used
 * by the plan panel, its subcomponents, and the plan checklist.
 */

/** Fan-out execution modes a plan can publish (plan-meta `execution`). */
export const EXECUTION_MODE = {
  WHOLE: "whole",
  STEPS: "steps",
} as const;
export type ExecutionMode = (typeof EXECUTION_MODE)[keyof typeof EXECUTION_MODE];

/** The plan node's `execution_default` knob values. */
export const EXECUTION_KNOB = {
  FOLLOW: "follow",
} as const;

/** executionSource values recorded in plan-meta at approve. */
export const EXECUTION_SOURCE = {
  OVERRIDE: "override",
} as const;

/** Node actions the plan panel dispatches through the flow action callback. */
export const PLAN_ACTION = {
  START: "start_plan",
  REFINE: "refine_plan",
  APPROVE: "approve_plan",
  RETRY: "retry",
  CANCEL: "cancel",
} as const;

/** Plan-checklist row actions. */
export const PLAN_STEP_ACTION = {
  SET: "set_plan_step",
  UPDATE: "update_plan_steps",
} as const;

/** Plan-checklist step statuses. */
export const PLAN_STEP_STATUS = {
  DONE: "done",
  PENDING: "pending",
} as const;

/** Plan-checklist row provenance values. */
export const PLAN_STEP_ORIGIN = {
  USER: "user",
} as const;

/** Plan-checklist row completion attribution values. */
export const PLAN_STEP_COMPLETED_BY = {
  BUILD: "build",
} as const;

/** The plan node key as referenced by the prompt modals. */
export const PLAN_NODE_KEY = "plan" as const;
