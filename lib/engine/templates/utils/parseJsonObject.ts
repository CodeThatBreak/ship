import "server-only";

/** Defensive JSON-object read for a raw config value (Postgres Json columns
 *  arrive parsed; legacy TEXT strings still parse). */
export const parseJsonObject = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
