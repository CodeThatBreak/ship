import "server-only";

import ipaddr from "ipaddr.js";
import { lookup } from "node:dns/promises";
import { SsrfError } from "./ssrf-error";
import type { Pinned } from "./ssrf-guard";

/**
 * IP classification for the SSRF guard: every "internal" range ipaddr.js knows
 * about. `::ffff:w.x.y.z` mapped addresses are re-classified in IPv4 space.
 */

const V4_FORBIDDEN = new Set([
  "unspecified", "loopback", "private", "linkLocal", "multicast", "broadcast",
  "carrierGradeNat", "reserved",
]);

const V6_FORBIDDEN = new Set([
  "unspecified", "loopback", "linkLocal", "multicast", "uniqueLocal",
  "ipv4Mapped", "6to4", "rfc6052", "rfc6145", "teredo", "reserved",
]);

export const RESOLVE_TIMEOUT_MS = 5_000;

/** Strip URL-style brackets so ipaddr.js can parse IPv6 literals. */
export const ipLiteralHost = (hostname: string): string => {
  if (hostname.startsWith("[") && hostname.endsWith("]") && hostname.length > 2) {
    return hostname.slice(1, -1);
  }
  return hostname;
};

export function validateIpLiteral(hostname: string): Pinned | null {
  const literal = ipLiteralHost(hostname);
  if (!ipaddr.isValid(literal)) return null;
  const addr = ipaddr.parse(literal) as ipaddr.IPv4 | ipaddr.IPv6;
  return checkedPin(literal, addr);
}

export function lookupAll(hostname: string): Promise<{ address: string; family: number }[]> {
  const lookupPromise = lookup(hostname, { all: true, verbatim: true }) as Promise<
    { address: string; family: number }[]
  >;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new SsrfError(`dns lookup timed out after ${RESOLVE_TIMEOUT_MS}ms for "${hostname}"`)),
      RESOLVE_TIMEOUT_MS,
    );
  });
  return Promise.race([lookupPromise, timeout]);
}

export function validateResolvedIps(
  hostname: string,
  addrs: { address: string; family: number }[],
): Pinned {
  let pin: Pinned | null = null;
  const seen = new Set<string>();
  for (const a of addrs) {
    if (seen.has(a.address)) continue;
    seen.add(a.address);
    if (!ipaddr.isValid(a.address)) {
      throw new SsrfError(`dns returned an unparseable address (${a.address}) for "${hostname}"`);
    }
    const p = checkedPin(a.address, ipaddr.parse(a.address) as ipaddr.IPv4 | ipaddr.IPv6);
    pin = pin ?? p;
  }
  if (!pin) throw new SsrfError(`no usable address for "${hostname}"`);
  return pin;
}

function checkedPin(text: string, addr: ipaddr.IPv4 | ipaddr.IPv6): Pinned {
  const why = forbiddenReason(addr);
  if (why) {
    throw new SsrfError(
      `resolved address ${text} is forbidden (${why}) — outbound calls may not target internal networks`,
    );
  }
  return { address: text, family: addr.kind() === "ipv4" ? 4 : 6 };
}

/** The forbidden classification, or null when the address may be used. */
function forbiddenReason(addr: ipaddr.IPv4 | ipaddr.IPv6): string | null {
  if (addr.kind() === "ipv4") {
    const range = (addr as ipaddr.IPv4).range();
    return V4_FORBIDDEN.has(range) ? range : null;
  }
  const v6 = addr as ipaddr.IPv6;
  const range = v6.range();
  if (range === "ipv4Mapped") {
    try {
      const v4 = v6.toIPv4Address();
      const v4Range = v4.range();
      return V4_FORBIDDEN.has(v4Range) ? `ipv4-mapped ${v4Range}` : null;
    } catch {
      return "ipv4Mapped";
    }
  }
  return V6_FORBIDDEN.has(range) ? range : null;
}
