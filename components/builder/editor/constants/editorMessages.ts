/** User-facing copy for the template editor — notices and error fallbacks
 *  live here instead of inline in hooks and components (§2.7). */
export const EDITOR_MESSAGES = {
  DETAIL_LOAD_FAILED: "Failed to load the template.",
  PROVIDERS_LOAD_FAILED: "Couldn't load task providers.",
  REPOS_LOAD_FAILED: "Couldn't load repos.",
  NODE_PLACED: "Node placed — drag from one of its handles to connect it.",
  NODE_DUPLICATED: "Node duplicated — drag from one of its handles to connect it.",
  START_NODE_UNDELETABLE:
    "The Start node can't be deleted — it's the flow's entry. Rewire its edges instead.",
  BUILTIN_NODE_UNDUPLICATABLE:
    "Built-in nodes can't be duplicated — add at most one from the palette.",
  START_NODE_ALREADY_PRESENT:
    "Only one Start node is allowed — this template already has one.",
  SAVED_NEW_VERSION: "Draft saved — new flows snapshot this version.",
  SAVED_KEPT_LOCAL_EDITS: "Draft saved — newer local edits were kept on the canvas.",
  SAVE_FAILED: "Failed to save the draft — try again.",
  duplicateEdge: (from: string, to: string) =>
    `Nodes are already connected (${from} → ${to}).`,
  duplicateCatalogNode: (name: string) =>
    `Only one "${name}" node is allowed — this template already has one.`,
} as const;
