/**
 * The `diff` fact's content when the diff capture failed (the stepRollup
 * precedent — a per-branch capture failure is non-fatal): the branch fact is
 * still established, the diff artifact records that its diff could not be
 * captured. Never a fabricated diff body.
 */
export const DIFF_UNAVAILABLE_CONTENT = "(diff unavailable)";
