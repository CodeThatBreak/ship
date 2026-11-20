import "server-only";

import type { EditorCatalogEntry } from "@/types/templateEditor";
import type { NodeTemplateRow } from "../../../../db/rows";

/** One node_templates row as the palette/editor API serializes it (locality included). */
export const serializeNodeTemplate = (nt: NodeTemplateRow): EditorCatalogEntry => ({
  id: nt.id,
  key: nt.key,
  name: nt.name,
  kind: nt.kind,
  version: nt.version,
  description: nt.description,
  icon: nt.icon,
  is_builtin: Boolean(nt.isBuiltin),
  config: nt.config,
  template_id: nt.templateId,
  is_local: Boolean(nt.templateId),
  created_at: nt.createdAt,
  updated_at: nt.updatedAt,
});
