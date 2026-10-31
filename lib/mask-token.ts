import "server-only";

/** Masked secret for settings UI (never the real value). */
export const maskToken = (t: string): string => {
  if (!t) return "";
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
};
