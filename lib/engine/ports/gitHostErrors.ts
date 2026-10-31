import "server-only";

import { UpstreamError } from "../../errors";

const MAX_UPSTREAM_BODY_CHARS = 500;

export const truncateUpstreamBody = (body: string): string =>
  body.length <= MAX_UPSTREAM_BODY_CHARS ? body : `${body.slice(0, MAX_UPSTREAM_BODY_CHARS)}…`;

export const redactSecretsInText = (text: string, secrets: readonly string[]): string => {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("••••");
  }
  return out;
};

export const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.round(asSeconds * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
};

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

export const gitHostErrorFromResponse = (
  path: string,
  status: number,
  body: string,
  retryAfterMs?: number,
): GitHostApiError => {
  const detail = truncateUpstreamBody(body);
  if (status === 401 || status === 403) return new GitHostAuthError(path, detail);
  if (status === 404) return new GitHostNotFoundError(path, detail);
  return new GitHostApiError(`Git host ${path} failed (${status}): ${detail}`, path, status, retryAfterMs);
};
