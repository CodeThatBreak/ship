"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { NodeRow } from "../types";

/** GET /api/node-templates — the `{ nodeTemplates }` payload's row list. */
async function fetchNodeTemplates(): Promise<NodeRow[]> {
  const payload = await fetchJson<{ nodeTemplates: NodeRow[] }>("/api/node-templates");
  return payload.nodeTemplates;
}

/**
 * The catalog's node-template list — hydrated by the server page through
 * prefetch + HydrationBoundary. Mutations invalidate `queryKeys.nodeTemplates`.
 */
export function useNodeList() {
  return useQuery({
    queryKey: queryKeys.nodeTemplates,
    queryFn: fetchNodeTemplates,
  });
}
