import "server-only";

import type { SplitChildPayload } from "../types/splitChildPayload";

/** Defensive payload parse (unparseable / foreign payload → null). */
export const parseSplitPayload = (raw: unknown): SplitChildPayload | null => {
  if (raw == null) return null;
  try {
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as SplitChildPayload | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.parentNodeKey !== "string") return null;
    if (!parsed.unit || typeof parsed.unit !== "object" || typeof parsed.unit.key !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
};
