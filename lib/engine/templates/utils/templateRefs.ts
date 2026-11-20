import "server-only";

/**
 * The distinct `{{...}}` refs a node's definition and instance config carry —
 * the union of the template's config refs and the instance-level overrides
 * (deduped: one lint problem per distinct ref, not per occurrence).
 */
export const templateRefs = (config: unknown, instanceConfig: unknown): string[] => {
  const out = new Set<string>();
  for (const ref of refsIn(config)) out.add(ref);
  for (const ref of refsIn(instanceConfig)) out.add(ref);
  return [...out];
};

/** Walk a JSON-ish config value collecting {{...}} refs from strings. */
const refsIn = (value: unknown, depth = 0): string[] => {
  const out: string[] = [];
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    return [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1].trim());
  }
  if (Array.isArray(value)) {
    for (const v of value) out.push(...refsIn(v, depth + 1));
    return out;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) out.push(...refsIn(v, depth + 1));
    return out;
  }
  return out;
};
