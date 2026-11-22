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
  isBuiltin: Boolean(nt.isBuiltin),
  config: nt.config,
  templateId: nt.templateId,
  isLocal: Boolean(nt.templateId),
  createdAt: nt.createdAt,
  updatedAt: nt.updatedAt,
});
