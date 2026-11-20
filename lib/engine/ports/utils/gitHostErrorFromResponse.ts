import "server-only";

import {
  GitHostApiError,
  GitHostAuthError,
  GitHostNotFoundError,
} from "../gitHostErrors";
import { truncateUpstreamBody } from "./upstreamErrorText";

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
