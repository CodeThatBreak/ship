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
 * The catalog's node-template list, hydrated server-side: the Server
 * Component page fetches the first paint's rows through the templateStore
 * service (the exact call /api/node-templates GET wraps) and passes them as
 * props — they feed `initialData`, so hydration carries data and no client
 * fetch or skeleton runs on first show. Later refetches (mutations
 * invalidate `queryKeys.nodeTemplates`) go through the route; `isFetching`
 * reports them without clearing the table (§2.8 — keep showing data).
 */
export function useNodeList(initialNodes: NodeRow[]) {
  return useQuery({
    queryKey: queryKeys.nodeTemplates,
    queryFn: fetchNodeTemplates,
    initialData: initialNodes,
    initialDataUpdatedAt: Date.now(),
  });
}
