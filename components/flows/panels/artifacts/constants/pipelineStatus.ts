/** The pipeline status vocabulary the git hosts report for a watched CI
 *  pipeline (the gate wait loop's wire values) — the snapshot renderer's
 *  closed set (§2.7). Distinct from the node run vocabulary (`FLOW_STATUS`):
 *  a green pipeline is `success`, not `done`. */
export const PIPELINE_STATUS = {
  SUCCESS: "success",
  FAILED: "failed",
} as const;

export type PipelineStatus = (typeof PIPELINE_STATUS)[keyof typeof PIPELINE_STATUS];

/** Badge color per watched-pipeline/job status — unlisted statuses render
 *  muted (undefined); `failed` intentionally carries no className, callers
 *  pair it with the `destructive` variant (the `STATUS_VARIANT` pattern). */
export const PIPELINE_STATUS_VARIANT: Partial<Record<string, string>> = {
  [PIPELINE_STATUS.SUCCESS]: "bg-success/10 text-success",
  running: "bg-info/10 text-info",
  pending: "bg-warning/10 text-warning",
  created: "bg-warning/10 text-warning",
  manual: "bg-warning/10 text-warning",
  waiting_for_resource: "bg-warning/10 text-warning",
};

/** The badge color for a pipeline/job status (muted when unlisted). */
export const pipelineStatusVariant = (status: string): string | undefined =>
  PIPELINE_STATUS_VARIANT[status];
