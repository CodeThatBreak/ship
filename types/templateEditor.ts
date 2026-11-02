/**
 * Client-safe template-editor wire types — the same JSON shapes the
 * template API routes serve (app/api/templates/**, app/api/node-templates).
 * The server hedges both sides here: `TemplateStore.editorPayload` (lib/)
 * and the client query hooks build/consume these types, so the two paths
 * can't drift apart. No imports from lib/ — this module must stay
 * client-safe (see docs/architecture/client-bundle-boundaries.md).
 */

/** A registered task provider's editor-facing slice (GET /api/tasks/providers). */
export interface EditorTaskProvider {
  kind: string;
  label: string;
  configured: boolean;
  contextFields: { key: string; label: string; type: string; required?: boolean }[];
}

import type { RepoSummary } from "@/types/repos";

/** A registered repo's editor-facing slice (GET /repos list) — the Bound-repo picker's option. */
export type EditorRepoChoice = Pick<RepoSummary, "id" | "name" | "local_path">;

/** One node instance row in the editor payload (snake_case API shape). */
export interface EditorNodeRow {
  key: string;
  node_template_id: string;
  label: string | null;
  /** per-node event trigger ({type, minutes?, wait_for?}, plus extras) */
  trigger: Record<string, unknown> | null;
  join_mode: string | null;
  config: Record<string, unknown>;
  input_map: Record<string, unknown>;
  kind: string | null;
  icon: string | null;
  catalog_name: string | null;
  /** node_templates row key ("plan"/"start"/...) — the fan-out UI gate */
  catalog_key: string | null;
  is_builtin: boolean;
  /** the backing row is local to this template (the canvas creator's rows) */
  is_local: boolean;
  x: number | null;
  y: number | null;
}

/** One edge row in the editor payload. */
export interface EditorEdgeRow {
  from: string;
  to: string;
  kind: string;
  label: string | null;
  condition: string | null;
}

/** The template meta slice the editor's header + settings drawer read. */
export interface EditorTemplateRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  is_builtin: boolean;
  trigger: Record<string, unknown>;
}

/** The flow trigger's provisioned hook (GET /api/templates/[id] `hook`). */
export interface EditorHookRow {
  id: string;
  secret: string;
  filter: string | null;
}

/** The full editor payload: template meta + hook + node instances + edges. */
export interface TemplateEditorDetail {
  template: EditorTemplateRow;
  hook: EditorHookRow | null;
  nodes: EditorNodeRow[];
  edges: EditorEdgeRow[];
}

/** The palette's catalog payload (GET /api/node-templates?templateId=…). */
export interface TemplateCatalogDetail {
  /** built-ins + the shared Library rows */
  nodeTemplates: EditorCatalogEntry[];
  /** rows private to this template (the palette's "This template" section) */
  templateNodeTemplates: EditorCatalogEntry[];
}

/** One node-templates catalog row as the palette renders it. */
export interface EditorCatalogEntry {
  id: string;
  key: string;
  name: string;
  kind: string;
  version: number;
  is_builtin: boolean;
  description: string | null;
  icon: string | null;
  /** owning template — set = template-local (the palette's "This template") */
  template_id?: string | null;
  is_local?: boolean;
  /** the declarative def's config (the row's knob defaults) */
  config?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}
