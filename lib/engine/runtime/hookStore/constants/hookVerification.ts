/** Standardwebhooks signature headers the spec-compliant verification checks. */
export const HEADER_NAMES = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

/** Shared-secret fallback header (senders that don't follow the spec). */
export const FALLBACK_HEADER = "x-devflow-secret";

/** Replay window for the fallback `webhook-timestamp` check. */
export const FALLBACK_TIMESTAMP_TOLERANCE_SEC = 5 * 60;
