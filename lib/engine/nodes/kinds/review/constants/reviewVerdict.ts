import "server-only";

/**
 * The closed review-verdict vocabulary — the review response's own domain
 * value, so it lives with the review kind that declares the contract and the
 * `publish_review_comments` verb that stamps it into the artifact meta reads
 * it from here (one vocabulary, no drift).
 *
 * `approve` with an empty comment list IS the clean review: an explicit
 * answer, never a bare empty array (which stays a contract miss — see
 * `parseReviewResponse`). Declarations are data; this set is code — a new
 * verdict is an engineering change here, never a config string.
 */
export const REVIEW_VERDICT = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request_changes",
} as const;

export type ReviewVerdict = (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT];

/** The tuple the zod enum renders from (closes the schema over the constant). */
export const REVIEW_VERDICTS = [
  REVIEW_VERDICT.APPROVE,
  REVIEW_VERDICT.REQUEST_CHANGES,
] as const;

/** The review artifact meta key the verdict stamps under. */
export const REVIEW_VERDICT_META_KEY = "review_verdict";

/** The recognized verdict an output carries, null when it declares none (or
 *  an unrecognized one — the closed union never widens from data). */
export const reviewVerdictOf = (output: Record<string, unknown> | null): ReviewVerdict | null => {
  const raw = output?.["verdict"];
  return typeof raw === "string" && isReviewVerdict(raw) ? raw : null;
};

const isReviewVerdict = (value: string): value is ReviewVerdict =>
  (REVIEW_VERDICTS as readonly string[]).includes(value);
