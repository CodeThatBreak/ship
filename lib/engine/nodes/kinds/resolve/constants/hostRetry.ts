import "server-only";

/** Bounded host retry (G5): the initial attempt plus this many retries. */
export const HOST_RETRY_EXTRA_ATTEMPTS = 2;

/** Bounded host retry backoff (G5): min(base · 2ⁿ, max) unless the host gives `retryAfterMs`. */
export const HOST_RETRY_BASE_DELAY_MS = 1_000;
export const HOST_RETRY_MAX_DELAY_MS = 8_000;
