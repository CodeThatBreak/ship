"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import { flowSummaries, type FlowSummary } from "@/types/flows";

/** Payload of GET /api/flows (loosely-typed engine rows). */
type FlowsPayload = { flows?: unknown[] };

/**
 * The workspace flow list. The page renders the first pageful server-side and
 * passes it as `initialData`, so the table paints with real rows; `staleTime`
 * is 0 so every remount still refetches (the original always-fetch behavior)
 * while showing the server row set underneath.
 */
export function useFlowsQuery(initialData: FlowSummary[]) {
  return useQuery({
    queryKey: queryKeys.flows.list,
    queryFn: async () => {
      const payload = await fetchJson<FlowsPayload>("/api/flows");
      return flowSummaries(payload.flows);
    },
    initialData,
    staleTime: 0,
  });
}
