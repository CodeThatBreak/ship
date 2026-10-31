/**
 * Smoke-check PlanTurnOutput parsing (replaces check-plan-followup.ts).
 *
 *   npx tsx scripts/check-plan-turn-output.ts
 */
import { PlanTurnOutput } from "../lib/engine/nodes/kinds/plan/schema";

const goodPlan = {
  markdown: "# Plan",
  steps: [{ title: "Do thing", detail: "", files: [], branch: null }],
};

const invalidPlan = {
  markdown: "# Plan",
  steps: [],
};

const assert = (label: string, ok: boolean) => {
  if (!ok) throw new Error(`check failed: ${label}`);
  console.log(`ok: ${label}`);
};

assert("plan-bearing turn", PlanTurnOutput.safeParse({ reply: "Answered.", plan: goodPlan }).success);
assert("explicit null plan", PlanTurnOutput.safeParse({ reply: "Answered.", plan: null }).success);
assert("reply only", PlanTurnOutput.safeParse({ reply: "Answered." }).success);
assert("invalid plan payload", !PlanTurnOutput.safeParse({ reply: "Done.", plan: invalidPlan }).success);
assert("empty reply rejected", !PlanTurnOutput.safeParse({ reply: "" }).success);

console.log("PlanTurnOutput checks passed.");
