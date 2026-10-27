import type { Node } from "@/types/flow";
import { EXECUTION_MODE, type ExecutionMode } from "./constants";

/** The effective resolution of the plan fan-out (§1 who-decides-the-mode). */
export interface ResolvedExecution {
  /** the plan node's raw `execution_default` knob (also holds "follow") */
  knob: string | undefined;
  /** the execution mode the selected plan version publishes (plan-meta `execution`) */
  published: ExecutionMode;
  /** who decided the published value: "planner" | "override" | "unknown" */
  publishedSource: string;
  /** the planner's one-line rationale for the published decision */
  plannerRationale: string | null;
  /** effective resolution: the knob wins unless it defers to the planner */
  resolution: ExecutionMode;
}

/**
 * Plan fan-out (§1 who-decides-the-mode): the published execution resolution
 * (plan-meta `execution` on the selected version) + the plan node's knob
 * precedence. `follow` plans publish the PLANNER's decision (with a one-line
 * rationale); the footer offers the override control at approve (Phase 3B) —
 * forcing whole/steps writes executionSource "override" into the plan-meta on
 * approve_plan.
 */
export function resolveExecution(
  node: Node,
  meta: Record<string, unknown> | undefined,
): ResolvedExecution {
  const knob = typeof node.config?.execution_default === "string" ? node.config.execution_default : undefined;
  const published = meta?.execution === EXECUTION_MODE.STEPS ? EXECUTION_MODE.STEPS : EXECUTION_MODE.WHOLE;
  const publishedSource = typeof meta?.executionSource === "string" ? meta.executionSource : "unknown";
  const plannerRationale = typeof meta?.execution_rationale === "string" ? meta.execution_rationale : null;
  const resolution = knob === EXECUTION_MODE.STEPS ? EXECUTION_MODE.STEPS : published;
  return { knob, published, publishedSource, plannerRationale, resolution };
}

/** Label of what a resolution will execute as ("one run" / "step-by-step (n steps)"). */
export function executionLabel(mode: ExecutionMode, stepCount: number): string {
  return mode === EXECUTION_MODE.STEPS
    ? `step-by-step (${stepCount} step${stepCount === 1 ? "" : "s"})`
    : "one run";
}
