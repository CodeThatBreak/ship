import "server-only";

import { UpstreamError } from "../../errors";

/** Typed errors for the git-host port: timeouts, API failures (with HTTP status + `retryAfterMs`), missing resources and auth failures. Route handlers map them to responses; never throw these outside the git-host path. */
export class GitHostTimeoutError extends UpstreamError {
  constructor(readonly path: string, timeoutMs: number) {
    super(`Git host request timed out after ${timeoutMs}ms (${path})`);
  }
}

/** A git-host HTTP call failed with a status the caller can branch on (404 → {@link GitHostNotFoundError}, 401 → {@link GitHostAuthError}); `retryAfterMs` carries the host's backoff hint when present. */
export class GitHostApiError extends UpstreamError {
  constructor(
    message: string,
    readonly path: string,
    readonly httpStatus: number,
    readonly retryAfterMs?: number,
  ) {
    super(message, httpStatus);
  }
}

/** The requested git-host resource does not exist (or is invisible to the credentials) — 404 by construction. */
export class GitHostNotFoundError extends GitHostApiError {
  constructor(path: string, detail: string) {
    super(`Git host resource not found (${path}): ${detail}`, path, 404);
  }
}

/** Git-host credentials were rejected — 401 by construction; the fix is configuration, never a retry. */
export class GitHostAuthError extends GitHostApiError {
  constructor(path: string, detail: string) {
    super(`Git host authentication failed (${path}): ${detail}`, path, 401);
  }
}
