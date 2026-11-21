import "server-only";

/**
 * The `diff` fact's artifact-meta vocabulary (Task 08 — AGENTS §2.7): the
 * keys the FactStore writes into a `kind: "diff"` artifact's meta and the
 * closed attribution values. The client renderer mirrors this vocabulary in
 * `components/flows/panels/artifacts/constants/diffFactMeta.ts` (client code
 * never imports from `lib/`).
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

/** The attribution values: "agent" = `git diff baseSha..head` (the run's own
 *  work — later user commits excluded by the pinned capture), "all" = the
 *  branch's whole diff vs its base (the pre-Task-08 behavior). Author-email
 *  filtering is deliberately NOT how "agent" is derived — local agents commit
 *  as the user's git config, so email filters are fragile. */
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