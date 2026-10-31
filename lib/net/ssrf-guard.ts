import "server-only";

import http from "node:http";
import https from "node:https";
import { lookupAll, validateIpLiteral, validateResolvedIps } from "./ssrf-helpers";

/**
 * SSRF guard for template-authored outbound calls (plan §4.4). Own ~80-line
 * util per the plan — no `ip-address` / `private-ip` (2026 SSRF CVEs); the
 * parser is `ipaddr.js`, and the guard **pins the IP it checked** so hostname
 * re-resolution between check and connect is impossible.
 *
 * Checks, per request hop:
 *  - scheme http/https only
 *  - hostname against the settings allowlist (`http_allowlist`, empty =
 *    deny-by-default for template-authored nodes)
 *  - DNS-resolve once; *every* resolved address must be public
 *    (loopback / private / link-local / CGNAT / ULA / multicast / reserved /
 *    broadcast are rejected — IPv4-mapped IPv6 is re-classified as IPv4)
 *  - the pinned address drives the connection (custom net lookup), keeping
 *    TLS SNI + Host on the original name
 *  - every redirect hop is resolved + re-validated before following
 */

export interface GuardedRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs: number;
  allowlist: string[];
  maxRedirects?: number;
}

export interface GuardedResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

/** A handler rejected the target URL with a specific reason. */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const BLOCKED = {
  scheme: (s: string) => `protocol "${s}:" is not allowed — http/https only`,
  allow: (h: string) =>
    `hostname "${h}" is not on the http allowlist — add it under Settings → HTTP allowlist (default: deny)`,
  ip: (ip: string, why: string) =>
    `resolved address ${ip} is ${why} — outbound calls may not target internal networks`,
};

function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase();
    return host === e || host.endsWith(`.${e}`);
  });
}

/** Validate scheme + hostname allowlist; throw a readable SsrfError otherwise. */
export function assertUrlPolicy(raw: string, allowlist: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError(BLOCKED.scheme(url.protocol));
  if (!hostAllowed(url.hostname, allowlist)) throw new SsrfError(BLOCKED.allow(url.hostname));
  return url;
}

export async function guardedRequest(req: GuardedRequest): Promise<GuardedResponse> {
  let url = assertUrlPolicy(req.url, req.allowlist);
  const maxRedirects = req.maxRedirects ?? 5;
  let method = req.method.toUpperCase();
  let body = req.body ?? null;

  for (let hop = 0; ; hop++) {
    const pinned = await resolveAndCheck(url);
    const res = await performHop(url, method, req.headers, body, pinned, req.timeoutMs);

    if ([301, 302, 303, 307, 308].includes(res.status) && hop < maxRedirects && res.headers.location) {
      const next = new URL(res.headers.location, url);
      url = assertUrlPolicy(next.toString(), req.allowlist); // every hop re-validated
      if (res.status === 303 || (res.status === 301 && method === "POST") || (res.status === 302 && method === "POST")) {
        method = "GET";
        body = null;
      }
      continue;
    }
    return res;
  }
}

// ── internals ────────────────────────────────────────────────────────────────

export interface Pinned {
  address: string;
  family: 4 | 6;
}

/** Resolve once, validate every answer, pin the first public address. */
async function resolveAndCheck(url: URL): Promise<Pinned> {
  const literal = validateIpLiteral(url.hostname);
  if (literal) return literal;
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookupAll(url.hostname);
  } catch (e: unknown) {
    throw new SsrfError(`dns lookup failed for "${url.hostname}" — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!addrs.length) throw new SsrfError(`dns lookup returned no addresses for "${url.hostname}"`);
  return validateResolvedIps(url.hostname, addrs);
}

function request(
  url: URL,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | null,
  pinned: Pinned,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const LIMIT = 5 * 1024 * 1024;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: pinned.address,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          // the pinned address drives the TCP connection; Host + TLS SNI keep
          // the original hostname (no re-resolution between check and connect)
          Host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
          ...headers,
        },
        servername: url.protocol === "https:" ? url.hostname : undefined,
        lookup: (_host: unknown, _opts: unknown,
          cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
          cb(null, pinned.address, pinned.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > LIMIT) {
            req.destroy();
            reject(new SsrfError("response exceeds the 5 MB guard cap"));
            return;
          }
          chunks.push(c);
        });
        res.on("error", (e) => reject(e));
        res.on("end", () => {
          const heads: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            const val = Array.isArray(v) ? v.join(", ") : v;
            if (val != null) heads[k.toLowerCase()] = val;
          }
          resolve({ status: res.statusCode ?? 0, headers: heads, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    ) as import("node:http").ClientRequest;
    req.setTimeout(timeoutMs, () => {
      req.destroy(new SsrfError(`request timed out after ${timeoutMs}ms`));
    });
    req.on("error", (e) => reject(e));
    if (body != null && method !== "GET" && method !== "HEAD") req.write(body);
    req.end();
  });
}

async function performHop(
  url: URL,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | null,
  pinned: Pinned,
  timeoutMs: number,
): Promise<GuardedResponse> {
  const res = await request(url, method, headers, body, pinned, timeoutMs);
  if (res.status === 0) throw new SsrfError(`no response from ${url.hostname}`);
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 400,
    headers: res.headers,
    body: res.body,
  };
}
