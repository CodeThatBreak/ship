"use client";
/**
 * The configurator's contract data layer (Phase 2 migration): each node
 * instance's /api/contracts read as one query — the request URL is the
 * identity (the def/kind plus the instance config, which the contract
 * merges over). Consumers: the node configurator drawer and the edge
 * editor (the source node's contract feeds the condition vocabulary).
 *
 * Per-instance, unlike the templates feature's same-named (now
 * `use-node-schema-contract`) per-kind contract hook — both share the
 * `queryKeys.nodeContracts` cache keyed by request URL.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { contractsUrl, type EditorNode, type NodeContract } from "../types";

/**
 * GET /api/contracts parsed — null when the resolved contract has no input
 * (an unknown instance): callers render their empty/absent contract shape
 * instead of throwing the read away.
 */
export async function fetchNodeContract(url: string): Promise<NodeContract | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const c = (await res.json()) as NodeContract;
  return c?.input != null ? c : null;
}

/**
 * One node instance's contract. `null` node = disabled (the draft graph is
 * the caller's concern); a resolved-but-input-less contract arrives as
 * `undefined` data — see `fetchNodeContract`.
 */
export function useNodeContract(node: Pick<EditorNode, "nodeTemplateId" | "kind" | "catalog_name" | "config"> | null) {
  // null node = disabled — the fetch never runs without an instance
  const url = node ? contractsUrl(node) : null;
  return useQuery({
    queryKey: queryKeys.nodeContracts(url ?? "none"),
    queryFn: () => fetchNodeContract(url ?? "none"),
    enabled: url != null,
    // the URL carries the instance's config, so prompt-typing re-keys the
    // query — keep rendering the previous contract while the new one fetches
    // instead of going pending (a pending re-key unmounted the configurator's
    // whole Prompt tab on every keystroke)
    placeholderData: keepPreviousData,
  });
}
