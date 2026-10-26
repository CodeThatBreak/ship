import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "./fetch-json";

// The graph definition is a static template snapshot; refsresh it between
// session visits (the flow's own graph) but keep one per session otherwise.
const GRAPH_STALE_MS = 5 * 60_000;

/** The flow's template snapshot as a graph definition. */
export type GraphDef = {
  order: string[];
  meta: Record<
    string,
    { label: string; kind?: string | null; icon?: string | null; outputs?: string[] | null }
  >;
  edges: [string, string, "next" | "loop"][];
  /** full edge specs (decision branch labels) */
  edgeSpecs?: {
    from: string;
    to: string;
    kind: string;
    label: string | null;
    condition: string | null;
  }[];
};

/**
 * The graph definition for the flow's template snapshot — with a flowId the
 * graph reflects that flow's snapshot (order/labels/edges), otherwise the
 * built-in registry graph.
 */
export function useGraphDef(flowId: string) {
  return useQuery({
    queryKey: queryKeys.graph(flowId),
    queryFn: () =>
      fetchJson<GraphDef>(`/api/graph${flowId ? `?flowId=${encodeURIComponent(flowId)}` : ""}`),
    staleTime: GRAPH_STALE_MS,
    placeholderData: keepPreviousData,
  });
}
