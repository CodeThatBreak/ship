import { ARTIFACT_KIND } from "../../artifacts/constants/artifactKinds";

/** The built-in panels' primary views. Order matches each tab strip. */
export const PIPELINE_TAB = {
  RUNS: "runs",
  USAGE: ARTIFACT_KIND.USAGE,
} as const;

export const REVIEW_TAB = {
  COMMENTS: "comments",
  USAGE: ARTIFACT_KIND.USAGE,
} as const;

export const RESOLVE_TAB = {
  RESULT: "result",
  USAGE: ARTIFACT_KIND.USAGE,
} as const;

export const BUILD_TAB = {
  DIFF: ARTIFACT_KIND.DIFF,
  STEPS: "steps",
  USAGE: ARTIFACT_KIND.USAGE,
} as const;

export type PipelineTab = (typeof PIPELINE_TAB)[keyof typeof PIPELINE_TAB];
export type ReviewTab = (typeof REVIEW_TAB)[keyof typeof REVIEW_TAB];
export type ResolveTab = (typeof RESOLVE_TAB)[keyof typeof RESOLVE_TAB];
export type BuildTab = (typeof BUILD_TAB)[keyof typeof BUILD_TAB];
