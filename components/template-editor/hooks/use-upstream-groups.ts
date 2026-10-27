"use client";
/**
 * The node configurator's upstream variable vocabulary: one query per
 * upstream node instance's contract, resolved in parallel — the variable
 * groups for the incoming edges. The cache key includes the instance config —
 * the start node's contract is declared per instance, so its published
 * variables differ between start instances.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import type { EditorEdge, EditorNode, NodeContract } from "../types";
import { contractsUrl, nodeLabel } from "../types";
import { fetchNodeContract } from "./use-node-contract";
import { schemaRows } from "../variables";

/** The edge kind that carries execution flow — the only kind whose source
 *  publishes into the next node's input (loop edges re-trigger instead). */
export const NEXT_EDGE_KIND = "next";

/** An edge arriving at the configured node, with the source node resolved. */
export interface IncomingLink {
  edge: EditorEdge;
  /** index in the draft's edge list (stable — only used for display) */
  edgeIndex: number;
  source: EditorNode | null;
}

/** One upstream node's pickable variables (grouped by source in the pickers). */
export interface UpstreamGroup {
  source: EditorNode;
  edge: EditorEdge;
  label: string;
  fields: { name: string; type: string; required: boolean }[];
}

/** An upstream source's cache identity — the def plus the instance config. */
function cacheKeyOf(src: EditorNode): string {
  const cfg =
    src.config && Object.keys(src.config).length
      ? JSON.stringify(src.config)
      : "";
  return `${src.nodeTemplateId}::${cfg}`;
}

export function useUpstreamGroups(incoming?: IncomingLink[]): UpstreamGroup[] {
  // distinct upstream sources by cache key (a source may be linked through
  // several edges; each unique def+config contract is fetched once)
  const sources = useMemo(() => {
    const byKey = new Map<string, EditorNode>();
    for (const link of incoming ?? []) {
      if (!link.source) continue;
      const key = cacheKeyOf(link.source);
      if (!byKey.has(key)) byKey.set(key, link.source);
    }
    return [...byKey.values()];
  }, [incoming]);

  const contracts = useQueries({
    queries: sources.map((src) => ({
      queryKey: queryKeys.nodeContracts(contractsUrl(src)),
      queryFn: () => fetchNodeContract(contractsUrl(src)),
    })),
    combine: (results) => {
      const byKey: Record<string, NodeContract | null> = {};
      sources.forEach((src, i) => {
        byKey[cacheKeyOf(src)] = results[i]?.data ?? null;
      });
      return byKey;
    },
  });

  return useMemo(() => {
    const groups: UpstreamGroup[] = [];
    for (const link of incoming ?? []) {
      if (!link.source) continue;
      groups.push({
        source: link.source,
        edge: link.edge,
        label: nodeLabel(link.source),
        fields: schemaRows(contracts[cacheKeyOf(link.source)]?.output ?? null),
      });
    }
    return groups;
  }, [incoming, contracts]);
}
