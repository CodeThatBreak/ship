import "server-only";

/** Max serialized size for HTTP bodies / artifacts and decision prompt context. */
export const PAYLOAD_DIGEST_MAX_CHARS = 20_000;

const HTTP_RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "date",
  "cache-control",
  "etag",
  "location",
  "x-request-id",
  "retry-after",
]);

/** Pick response headers safe to persist and show in artifacts (drops cookies, auth, etc.). */
export const allowlistResponseHeaders = (
  headers: Record<string, string> | null | undefined,
): Record<string, string> => {
  if (!headers || typeof headers !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (HTTP_RESPONSE_HEADER_ALLOWLIST.has(key) && typeof v === "string") out[key] = v;
  }
  return out;
};

/**
 * Cap a value for storage/display by measuring its JSON serialization (strings
 * by length). Returns the original value when under the cap.
 */
export const capSerializedPayload = (
  value: unknown,
  maxChars: number = PAYLOAD_DIGEST_MAX_CHARS,
): unknown => {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > maxChars ? `${value.slice(0, maxChars)}… (truncated)` : value;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  if (serialized.length <= maxChars) return value;
  return `${serialized.slice(0, maxChars)}… (truncated)`;
};

/** JSON text for prompts/artifacts with a hard size ceiling. */
export const digestJsonText = (
  value: unknown,
  maxChars: number = PAYLOAD_DIGEST_MAX_CHARS,
  indent = 2,
): string => {
  const text = JSON.stringify(value, null, indent) ?? "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (truncated)`;
};
