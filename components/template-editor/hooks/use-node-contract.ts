"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredNodeContractRequest } from "./use-deferred-node-contract-request";
import { nodeContractQueryOptions } from "../queries";
import { type EditorNode, type NodeContract } from "../types";

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
  const request = useDeferredNodeContractRequest(node);
  return useQuery({
    ...nodeContractQueryOptions(request ?? { cacheKey: "none", body: {} }),
    enabled: request != null,
    select: contractWithInput,
    placeholderData: keepPreviousData,
  });
};
