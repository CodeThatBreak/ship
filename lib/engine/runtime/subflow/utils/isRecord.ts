import "server-only";

/** Type guard for a record-shaped value (the payload/output derivation seam). */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);
