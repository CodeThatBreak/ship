"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { TemplateRow } from "../types";

/** GET /api/templates — the `{ templates }` payload's row list. */
async function fetchTemplates(): Promise<TemplateRow[]> {
  const payload = await fetchJson<{ templates: TemplateRow[] }>("/api/templates");
  return payload.templates;
}

/**
 * The gallery's template list, hydrated server-side: the Server Component
 * page fetches the first paint's rows through the templateStore service (the
 * exact call /api/templates GET wraps) and passes them as props — they feed
 * `initialData`, so hydration carries data and no client fetch or skeleton
 * runs on first show. Later refetches (mutations invalidate
 * `queryKeys.templatesGallery`) go through the route; `isFetching` reports
 * them without clearing the table (§2.8: background refetch keeps data).
 */
export function useTemplateList(initialTemplates: TemplateRow[]) {
  return useQuery({
    queryKey: queryKeys.templatesGallery,
    queryFn: fetchTemplates,
    initialData: initialTemplates,
    initialDataUpdatedAt: Date.now(),
  });
}
