"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import type { TemplateRow } from "../types";

/** GET /api/templates — the `{ templates }` payload's row list. */
async function fetchTemplates(): Promise<TemplateRow[]> {
  const payload = await fetchJson<{ templates: TemplateRow[] }>("/api/templates");
  return payload.templates;
}

/**
 * The gallery's template list — hydrated by the server page through
 * prefetch + HydrationBoundary (same keys as this hook). Mutations
 * invalidate `queryKeys.templatesGallery`; background refetches keep
 * the table visible (§2.8).
 */
export function useTemplateList() {
  return useQuery({
    queryKey: queryKeys.templatesGallery,
    queryFn: fetchTemplates,
  });
}
