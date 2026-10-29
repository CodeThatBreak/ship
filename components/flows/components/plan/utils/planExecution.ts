import type { Node } from "@/types/flow";
import { EXECUTION_MODE, type ExecutionMode } from "../constants";

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
  /** effective resolution: an explicit whole knob wins; follow (and a LEGACY
   *  "steps" knob — it now means the same per-branch fan-out) defer to the
   *  published value */
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
  // the raw knob domain is whole|follow now; a LEGACY raw knob "steps" (the
  // retired per-step child flows) means what "follow" means — the published
  // value wins, so old configs surface their published (per-branch) resolution
  const resolution = knob === EXECUTION_MODE.WHOLE ? EXECUTION_MODE.WHOLE : published;
  return { knob, published, publishedSource, plannerRationale, resolution };
}

/** Label of what a resolution will execute as ("one run" / "one child flow per branch (n branches)"). */
export function executionLabel(mode: ExecutionMode, branchCount: number): string {
  return mode === EXECUTION_MODE.STEPS
    ? `one child flow per branch (${branchCount} branch${branchCount === 1 ? "" : "es"})`
    : "one run";
}
