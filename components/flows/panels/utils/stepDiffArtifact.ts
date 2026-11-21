import type { Node, PlanStepRow } from "@/types/flow";

/** The aggregate step entry's per-step diff artifact key (task 25, use case
 *  8b) — the client mirror of the `DEFAULT_FANOUT_OUTPUT` step shape. */
export const FANOUT_STEP_DIFF_ARTIFACT = "diff_artifact";

/** One aggregate step entry the fan-out rollup publishes (client view). */
interface FanoutAggregateStep {
  id?: unknown;
  diff_artifact?: unknown;
}

/** The step card's per-step diff: the rollup publishes each resolved code
 *  step's own pre-merge diff artifact id on its aggregate entry (`steps[].diff_artifact`,
 *  next to the `artifact_id` precedent); the artifact rides the parent node's
 *  artifact list — the same panel data path the merged diff reaches the panel
 *  through. Null when the step has no per-step diff fact. */
export const stepDiffArtifactId = (node: Node | undefined, step: PlanStepRow): string | null => {
  const steps = node?.output?.steps;
  if (!Array.isArray(steps)) return null;
  const stepId = step.meta_id ?? step.id;
  const entry = steps.find(
    (s): s is FanoutAggregateStep =>
      typeof s === "object" && s !== null && !Array.isArray(s) && (s as FanoutAggregateStep).id === stepId,
  );
  const artifactId = entry?.[FANOUT_STEP_DIFF_ARTIFACT];
  return typeof artifactId === "string" ? artifactId : null;
};
