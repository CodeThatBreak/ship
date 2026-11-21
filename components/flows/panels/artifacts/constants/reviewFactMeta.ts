/** The `review` artifact's meta keys + verdict vocabulary (§2.7) — the
 *  client mirror of the engine's review posting meta (the client never
 *  imports `lib/`, the pipelineFactMeta/diffFactMeta precedent). The
 *  `postedHashes` idempotency ledger rides this meta engine-side; the
 *  renderer reads the posted count and the verdict projection. */
export const REVIEW_FACT_META = {
  /** how many comments the run posted (the ledger's size) */
  POSTED: "posted",
  /** the per-comment post hashes (the idempotency ledger itself) */
  POSTED_HASHES: "postedHashes",
  /** the change request the comments were posted on */
  MR_IID: "mrIid",
  /** the branch the review ran for (per-branch flows) */
  BRANCH_NAME: "branchName",
  /** the run's structured verdict (task 19) — a downstream decision/gate
   *  consumes it via the output contract; this is the projection */
  VERDICT: "review_verdict",
} as const;

/** The closed review-verdict vocabulary — the client mirror of the engine's
 *  `REVIEW_VERDICT` (declarations are data; this set is code). */
export const REVIEW_VERDICT = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request_changes",
} as const;

export type ReviewVerdict = (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT];

/** Badge color per verdict — request-changes reads as a warning. */
export const REVIEW_VERDICT_VARIANT: Partial<Record<string, string>> = {
  [REVIEW_VERDICT.APPROVE]: "bg-success/10 text-success",
  [REVIEW_VERDICT.REQUEST_CHANGES]: "bg-warning/10 text-warning",
};

/** The thread status the renderer's projected review threads carry — a
 *  freshly posted review comment is open on the host (the comment-status
 *  vocabulary's client mirror; the resolve loop owns the closing). */
export const REVIEW_THREAD_STATUS = {
  OPEN: "open",
} as const;

/** The author label on a review run's posted comments (the note body's
 *  `**AI Review**` marker, projected). */
export const REVIEW_THREAD_AUTHOR = "AI review";
