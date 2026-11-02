import "server-only";

/** Wall-clock limit for outbound GitLab HTTP calls (settings checks, poller, nodes). */
export const GITLAB_HTTP_TIMEOUT_MS = 15_000;

/** Cap list pagination so a runaway host cannot loop forever. */
export const GITLAB_MAX_LIST_PAGES = 20;

/** Idempotent GET retries on rate limits and transient gateway errors. */
export const GITLAB_MAX_GET_RETRIES = 3;

export const GITLAB_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
