import "server-only";

/** A JSON Schema node's primary type ("array" / "string" / …) — null when undeclared. */
export const schemaTypeOf = (s: unknown): string | null => {
  if (!s || typeof s !== "object") return null;
  const t = (s as { type?: unknown }).type;
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return null;
};
