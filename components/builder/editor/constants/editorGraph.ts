/** Graph vocabulary authored by the editor that has no home in `constants/`.
 *  Values shared with the rest of the app (node kinds, catalog keys, routes)
 *  are imported from their owning module instead of duplicated here (§2.7). */

/** Node kinds/roles that only the editor renders as badges or join modes. */
export const EDITOR_NODE_KIND = {
  BUILTIN: "builtin",
  ANY_JOIN: "any",
  ALL_JOIN: "all",
} as const;

/** Edge kinds the editor can author. */
export const EDGE_KIND = {
  NEXT: "next",
} as const;

/** Trigger kind seeded onto freshly placed instances. */
export const TRIGGER_TYPE = {
  AUTO: "auto",
} as const;

export const DEFAULT_NODE_ICON = "bot";
export const DEFAULT_NEW_NODE_NAME = "node";
export const DRAFT_ID_PREFIX = "draft:";
/** Inert cache key for the start-node contract query until a start node exists. */
export const NO_CONTRACT_CACHE_KEY = "none";
