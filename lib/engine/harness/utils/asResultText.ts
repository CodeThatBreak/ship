import "server-only";

/** Serialize a tool result payload (unknown per the SDK) to display text. */
export const asResultText = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v);
};
