/** Artifact kinds the renderer registry knows — use these, never raw literals. */
export const ARTIFACT_KIND = {
  MARKDOWN: "markdown",
  JSON: "json",
  DIFF: "diff",
  PLAN: "plan",
  USAGE: "usage",
  /** the CI gate's durable-wait progress snapshot (task 18): status badge,
   *  job list, fix-run history — any gate node's wait renders through it. */
  PIPELINE: "pipeline",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND];
