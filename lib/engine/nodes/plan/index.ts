export { PlanNode, mergeBranchRefine, diffBranchSteps, CONTEXT_BLOCKS, type ContextBlockId, type ContextBlockInfo } from "./plan-node";
export { PlanMetaParser } from "./plan-meta-parser";
export {
  PlanBranch,
  PlanInput,
  PlanMeta,
  PlanStep,
  PlanMetaStep,
  PlanOutput,
  SimplePlanResponse,
  ComplexPlanResponse,
  SubPlanResponse,
  validateSimplePlan,
  validateComplexPlan,
  validateSubPlan,
  validatePlanMeta,
  type PlanValidationError,
  type PlanMetaValidationError,
} from "./schema";

import { PlanNode } from "./plan-node";
import type { FlowCtx } from "../base";

// ── legacy helpers ───────────────────────────────────────────────────────────
const planNodeForHelpers = new PlanNode();

/** Convenience for the prompt-preview route: the plan prompt as it would be sent. */
export function previewPrompt(ctx: FlowCtx, feedback?: string): string {
  return planNodeForHelpers.previewPrompt(ctx, feedback);
}

/**
 * Convenience for the prompt-preview route: the branch-scoped sub-plan refine
 * prompt (editable body) + context block list, or null for an unknown branch.
 */
export function previewSubPlanPrompt(ctx: FlowCtx, branch: string, contextBlocks?: string[]) {
  return planNodeForHelpers.previewSubPlanPrompt(ctx, branch, contextBlocks);
}
