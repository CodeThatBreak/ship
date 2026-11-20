import "server-only";

import crypto from "node:crypto";

/**
 * The per-attempt capability token (step 08, Invariant 10): minted by the
 * transition authority's claim together with the attempt id, presented by the
 * node's running agent on the agent-tools endpoint. Pure crypto helpers —
 * no state, no I/O.
 *
 * The compare digests BOTH sides before `crypto.timingSafeEqual` (which needs
 * equal-length inputs — the hookStore webhook-secret pattern): a length
 * mismatch must not leak timing either.
 */

/** 256 bits of entropy — a leaked token fails exactly one attempt. */
const TOKEN_BYTES = 32;

/** The `Bearer` credential the agent-tools endpoint authenticates. */
export const generateCapabilityToken = (): string =>
  crypto.randomBytes(TOKEN_BYTES).toString("hex");

export const capabilityTokensEqual = (provided: string, stored: string): boolean => {
  if (!provided || !stored) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(stored).digest();
  return crypto.timingSafeEqual(a, b);
};
