/** Server and client agree on edge dedupe — matches TemplateStore.validated(). */
export const edgeDedupeKey = (
  from: string,
  to: string,
  label: string | null | undefined,
): string => `${from}>${to}:${label?.trim() || ""}`;

/** Node instance keys allowed on save (letters, digits, underscores; letter first). */
export const TEMPLATE_NODE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/i;

export const normalizeTemplateNodeKeySlug = (slug: string): string =>
  TEMPLATE_NODE_KEY_PATTERN.test(slug) ? slug : `n_${slug.replace(/^[^a-z]+/i, "") || "node"}`;
