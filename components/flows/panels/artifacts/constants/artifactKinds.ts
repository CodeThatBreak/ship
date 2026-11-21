/** Artifact kinds the renderer registry knows — use these, never raw literals. */
export const ARTIFACT_KIND = {
  MARKDOWN: "markdown",
  JSON: "json",
  DIFF: "diff",
  PLAN: "plan",
  USAGE: "usage",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND];
