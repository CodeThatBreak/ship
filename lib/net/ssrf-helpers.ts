import "server-only";

import ipaddr from "ipaddr.js";
import { lookup } from "node:dns/promises";
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

export function validateIpLiteral(hostname: string): Pinned | null {
  if (!ipaddr.isValid(hostname)) return null;
  const addr = ipaddr.parse(hostname) as ipaddr.IPv4 | ipaddr.IPv6;
  return checkedPin(hostname, addr);
}

export function lookupAll(hostname: string): Promise<{ address: string; family: number }[]> {
  return lookup(hostname, { all: true, verbatim: true }) as Promise<{ address: string; family: number }[]>;
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
      throw new SsrfReason(`dns returned an unparseable address (${a.address}) for "${hostname}"`);
    }
    const p = checkedPin(a.address, ipaddr.parse(a.address) as ipaddr.IPv4 | ipaddr.IPv6);
    pin = pin ?? p;
  }
  if (!pin) throw new SsrfReason(`no usable address for "${hostname}"`);
  return pin;
}

function checkedPin(text: string, addr: ipaddr.IPv4 | ipaddr.IPv6): Pinned {
  const why = forbiddenReason(addr);
  if (why) {
    throw new SsrfReason(
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

/** Guard-local rejection carrying the classification — caught by the guard. */
export class SsrfReason extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfReason";
  }
}
