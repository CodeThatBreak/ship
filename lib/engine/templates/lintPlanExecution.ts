import "server-only";

import type { LintProblem } from "@/types/templateLint";

/**
 * The plan node's execution-knob check (step 09): `execution_default` is
 * domain whole | follow — a template still carrying the retired per-step
 * "steps" value (the pre-split-runtime child-flow fan-out) fails at
 * save/import instead of silently degrading to whole at run time. A targeted
 * value check, not a configSchema run (template lint stays schema-free).
 */
export const lintPlanExecution = (cfg: Record<string, unknown>, where: string, nodeKey: string, problems: LintProblem[]): void => {
  if (cfg.execution_default !== "steps") return;
  problems.push({
    where,
    message: 'execution_default "steps" is retired — the plan knob is "whole" | "follow" ("follow" lets the planner publish per-branch fan-out in the plan-meta)',
    nodeKey,
  });
};
