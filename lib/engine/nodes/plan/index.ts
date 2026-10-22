export { PlanNode } from "./plan-node";
export { PlanMetaParser } from "./plan-meta-parser";
export {
  PlanBranch,
  PlanInput,
  PlanMeta,
  PlanMetaStep,
  PlanOutput,
} from "./schema";

import { PlanNode } from "./plan-node";
import type { FlowCtx } from "../base";

// ── legacy helpers ───────────────────────────────────────────────────────────
const planNodeForHelpers = new PlanNode();

/** Convenience for the prompt-preview route: the plan prompt as it would be sent. */
export function previewPrompt(ctx: FlowCtx, feedback?: string): string {
  return planNodeForHelpers.previewPrompt(ctx, feedback);
}
