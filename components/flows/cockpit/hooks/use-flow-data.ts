"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { FlowData } from "@/types/flow";

/**
 * The flow's live snapshot (§2.2 feature hook): the server loader's snapshot is
 * handed in as TanStack Query's `initialData` (the hydration-props split) and
 * the query refreshes from `GET /api/flows/:id` — `staleTime: 0` keeps the
 * hydrated payload immediately stale so the mount-time refetch runs right away
 * (the events hook re-invalidates this query on every new event batch).
 */
export function useFlowData(flowId: string, initialData: FlowData) {
  return useQuery({
    queryKey: queryKeys.flows.detail(flowId),
    queryFn: () => fetchJson<FlowData>(`/api/flows/${flowId}`),
    initialData,
    staleTime: 0,
  });
}
