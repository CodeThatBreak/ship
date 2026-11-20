import "server-only";

/** Merge config layers shallowly (later layers win; only plain-object layers contribute). */
export const shallowMerge = (a: unknown, b: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const layer of [a, b]) {
    if (layer && typeof layer === "object" && !Array.isArray(layer)) {
      Object.assign(out, layer as Record<string, unknown>);
    }
  }
  return out;
};
