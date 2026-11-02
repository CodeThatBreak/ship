"use client";
/**
 * GET /api/templates — the flow-template gallery (Phase 3C), extracted from
 * ConfigFieldRow.tsx: the fan-out child picker's options. Hidden auto-wrapped
 * child templates are excluded (§2 data model): a child template is referenced
 * by id, never picked.
 */
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";

/** A flow template as the fan-out child picker needs it (GET /api/templates:
 *  the gallery, hidden auto-wrapped child templates excluded, Phase 3C). */
export interface GalleryTemplate {
  id: string;
  name: string;
  description?: string | null;
  nodeCount?: number;
}

export async function fetchGalleryTemplates(): Promise<GalleryTemplate[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = (await res.json()) as { templates?: GalleryTemplate[] };
  return Array.isArray(d.templates) ? d.templates : [];
}

/** The gallery query behind the fan-out child picker (Phase 3C). */
export function useGalleryTemplates() {
  return useQuery({
    queryKey: queryKeys.templatesGallery,
    queryFn: fetchGalleryTemplates,
  });
}
