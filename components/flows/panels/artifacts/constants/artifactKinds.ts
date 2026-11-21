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
  /** a review run's posted-comment projection (task 19): the threads the
   *  run published, the postedHashes ledger + verdict in the meta. */
  REVIEW: "review",
  /** a resolve run's summary/decisions ledger (task 19): the summary, the
   *  per-comment decisions, the effect ledger in the meta. */
  RESOLVE: "resolve",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND];
