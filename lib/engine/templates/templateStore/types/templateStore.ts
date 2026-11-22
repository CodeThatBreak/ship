import "server-only";

/** Pending declarative defs from the template editor save payload. */
export interface DraftNodeTemplateInput {
  draftId?: string;
  name?: string;
  kind?: string;
  icon?: string | null;
  description?: string | null;
  config?: Record<string, unknown>;
}

/**
 * The runtime role of a template node — what the UI (graph, configurator) and
 * the def resolver need about the underlying catalog entry.
 */
export interface TemplateNodeMeta {
  /** node_templates row id (the def key for declarative kinds) */
  nodeTemplateId: string;
  /** catalog key (built-ins use NODE_KEYS values) */
  catalogKey: string;
  kind: string;
  /** lucide icon name for the graph editor */
  icon: string | null;
  name: string;
  isBuiltin: boolean;
}
