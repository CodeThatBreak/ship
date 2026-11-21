import "server-only";

/**
 * The closed review-verdict vocabulary (task 19's optional structured fact):
 * the verdict a review run's output contract may declare alongside its
 * comment list. The `publish_review_comments` verb stamps it into the review
 * artifact's meta, so a downstream decision/gate consumes it through the
 * flow's contract layer (Invariant 5) with the artifact as the
 * human-facing projection. Declarations are data; this set is code — a new
 * verdict is an engineering change here, never a config string.
 */
export const REVIEW_VERDICT = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request_changes",
} as const;

export type ReviewVerdict = (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT];

/** The review artifact meta key the verdict stamps under. */
export const REVIEW_VERDICT_META_KEY = "review_verdict";

/** The recognized verdict an output carries, null when it declares none (or
 *  an unrecognized one — the closed union never widens from data). */
export const reviewVerdictOf = (output: Record<string, unknown> | null): ReviewVerdict | null => {
  const raw = output?.["verdict"];
  return typeof raw === "string" && isReviewVerdict(raw) ? raw : null;
};

const isReviewVerdict = (value: string): value is ReviewVerdict =>
  (Object.values(REVIEW_VERDICT) as readonly string[]).includes(value);
