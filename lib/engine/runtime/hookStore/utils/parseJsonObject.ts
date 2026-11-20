export const parseJsonObject = (raw: unknown): Record<string, unknown> => {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
};
