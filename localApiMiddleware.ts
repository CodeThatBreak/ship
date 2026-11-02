import { LOCAL_API, LOCAL_API_EXEMPT_PREFIXES } from "./constants/localApi";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const jsonError = (status: number, message: string): Response =>
  Response.json({ error: message }, { status });

const tokensEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const isLocalApiExemptPath = (pathname: string): boolean =>
  LOCAL_API_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const originMatchesHost = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

const secFetchSiteAllowed = (req: Request): boolean => {
  const site = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (!site) return true;
  return site === "same-origin" || site === "same-site" || site === "none";
};

const contentTypeIsJson = (req: Request): boolean => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const length = req.headers.get("content-length");
  if (length === "0") return true;
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!type) return method === "DELETE";
  return type === "application/json";
};

const readRequestToken = (req: Request): string =>
  req.headers.get(LOCAL_API.TOKEN_HEADER)?.trim() ??
  req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
  "";

/**
 * Gate mutating `/api/*` requests. Returns a Response when the request must be
 * rejected, otherwise null. Lives at repo root (not under lib/) so Next.js
 * middleware does not pull server-only modules into the Edge bundle.
 */
export const evaluateLocalApiMiddleware = (
  req: Request,
  expectedToken: string,
): Response | null => {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/api/")) return null;
  if (isLocalApiExemptPath(pathname)) return null;
  if (!MUTATING.has(req.method.toUpperCase())) return null;

  if (!expectedToken) {
    return jsonError(503, "Local API token is not configured");
  }

  const token = readRequestToken(req);
  if (!token || !tokensEqual(token, expectedToken)) {
    return jsonError(401, "Unauthorized");
  }

  if (!originMatchesHost(req)) {
    return jsonError(403, "Origin is not allowed");
  }

  if (!secFetchSiteAllowed(req)) {
    return jsonError(403, "Cross-site request blocked");
  }

  if (!contentTypeIsJson(req)) {
    return jsonError(415, "Content-Type must be application/json");
  }

  return null;
};
