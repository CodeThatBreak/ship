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
import { nodeContractQueryOptions } from "../queries";
import { contractsUrl, type EditorNode, type NodeContract } from "../types";

/**
 * GET /api/contracts parsed — null when the resolved contract has no input
 * (an unknown instance): callers render their empty/absent contract shape
 * instead of throwing the read away.
 */
export const contractWithInput = (
  contract: NodeContract | undefined,
): NodeContract | null => (contract?.input != null ? contract : null);

/**
 * One node instance's contract. `null` node = disabled (the draft graph is
 * the caller's concern); a resolved-but-input-less contract arrives as
 * `null` data — see `contractWithInput`.
 */
export const useNodeContract = (
  node: Pick<
    EditorNode,
    "nodeTemplateId" | "kind" | "catalog_name" | "config"
  > | null,
) => {
  const url = node ? contractsUrl(node) : null;
  return useQuery({
    ...nodeContractQueryOptions(url ?? "none"),
    enabled: url != null,
    select: contractWithInput,
    placeholderData: keepPreviousData,
  });
};
