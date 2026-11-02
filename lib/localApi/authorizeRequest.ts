import "server-only";

import { LOCAL_API } from "../../constants/localApi";
import { localApiToken } from "./token";

const tokensEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const readRequestToken = (req: Request): string =>
  req.headers.get(LOCAL_API.TOKEN_HEADER)?.trim() ??
  req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
  "";

/** True when the request carries the process-local API token (browser UI or same host). */
export const localApiRequestAuthorized = (req: Request): boolean => {
  const expected = process.env[LOCAL_API.TOKEN_ENV]?.trim() || localApiToken();
  if (!expected) return false;
  const token = readRequestToken(req);
  return Boolean(token) && tokensEqual(token, expected);
};
