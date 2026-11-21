/**
 * Client-side mirror of the engine's diff-fact meta vocabulary (Task 08 —
 * `lib/engine/facts/constants/diffFactMeta.ts`): client code never imports
 * from `lib/`, so the keys and the closed attribution values are mirrored
 * here (the same pattern as `artifactKinds.ts` over the engine's
 * `ARTIFACT_KIND`). Keep the two in sync.
 */
export const DIFF_FACT_META = {
  /** the fact's branch name (the pre-Task-08 key, unchanged) */
  BRANCH: "branch",
  /** the capture's diff --stat line (the pre-Task-08 key, unchanged) */
  STAT: "stat",
  /** the run-start base SHA the "agent" projection anchors to */
  BASE_SHA: "baseSha",
  /** the branch head at capture — the staleness anchor the refresh action bumps */
  HEAD_SHA: "headSha",
  /** which projection the artifact content carries — "agent" | "all" */
  ATTRIBUTION: "attribution",
  /** the worktree-only variant flag: the agent left its changes uncommitted */
  UNCOMMITTED: "uncommitted",
  /** the other projection when both are computable — the renderer's toggle */
  ALT: "alt",
} as const;

/** The attribution values: "agent" = the run's own work (`baseSha..head`),
 *  "all" = the branch's whole diff vs its base. A diff artifact without the
 *  key (the pre-Task-08 shape) reads as "all". */
export const DIFF_ATTRIBUTION = {
  AGENT: "agent",
  ALL: "all",
} as const;
export type DiffAttribution = (typeof DIFF_ATTRIBUTION)[keyof typeof DIFF_ATTRIBUTION];

/** The keys inside `meta.alt` — the alternate projection's payload. */
export const DIFF_ALT_PROJECTION = {
  ATTRIBUTION: "attribution",
  STAT: "stat",
  RAW: "raw",
} as const;