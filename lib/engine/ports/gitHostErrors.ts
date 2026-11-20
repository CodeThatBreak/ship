import "server-only";

import { UpstreamError } from "../../errors";

export class GitHostTimeoutError extends UpstreamError {
  constructor(readonly path: string, timeoutMs: number) {
    super(`Git host request timed out after ${timeoutMs}ms (${path})`);
  }
}

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

export class GitHostNotFoundError extends GitHostApiError {
  constructor(path: string, detail: string) {
    super(`Git host resource not found (${path}): ${detail}`, path, 404);
  }
}

export class GitHostAuthError extends GitHostApiError {
  constructor(path: string, detail: string) {
    super(`Git host authentication failed (${path}): ${detail}`, path, 401);
  }
}
