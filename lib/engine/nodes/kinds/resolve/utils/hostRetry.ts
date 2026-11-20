import "server-only";

import type { HostRetrySleep } from "../types/resolveEffects";
import { GitHostApiError, GitHostTimeoutError } from "../../../../ports/gitHostErrors";
import {
  HOST_RETRY_BASE_DELAY_MS,
  HOST_RETRY_EXTRA_ATTEMPTS,
  HOST_RETRY_MAX_DELAY_MS,
} from "../constants/hostRetry";

export const defaultSleep: HostRetrySleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retries transient host failures only: timeouts, 429s, 5xx. 401/403/404 and anything else is permanent. */
export const isRetryableHostError = (e: unknown): boolean => {
  if (e instanceof GitHostTimeoutError) return true;
  if (e instanceof GitHostApiError) return e.httpStatus === 429 || e.httpStatus >= 500;
  return false;
};

/**
 * ONE bounded retry wrapper per host call (G5): up to
 * {@link HOST_RETRY_EXTRA_ATTEMPTS} extra attempts with backoff
 * min(1s · 2ⁿ, 8s) — the host's `retryAfterMs` wins when it is present.
 */
export const withHostRetry = async <T>(
  fn: () => Promise<T>,
  sleep: HostRetrySleep = defaultSleep,
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= HOST_RETRY_EXTRA_ATTEMPTS || !isRetryableHostError(e)) throw e;
      const backoff = Math.min(HOST_RETRY_BASE_DELAY_MS * 2 ** attempt, HOST_RETRY_MAX_DELAY_MS);
      const retryAfter = e instanceof GitHostApiError ? e.retryAfterMs : undefined;
      await sleep(retryAfter ?? backoff);
    }
  }
};
