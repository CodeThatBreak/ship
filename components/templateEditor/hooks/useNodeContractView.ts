"use client";
/**
 * The node configurator's resolved contract view: the Phase 2 contract query
 * (`use-node-contract`) plus the display contract derived from it. A resolved
 * contract with no input (unknown kind) renders as the empty contract so the
 * configurator's tabs stay usable; pending/error render as `null`.
 */
import { useMemo } from "react";
import type { EditorNode, NodeContract } from "../types";
import { useNodeContract } from "./useNodeContract";

export function useNodeContractView(node: EditorNode) {
  // the contract data layer (Phase 2): one /api/contracts read keyed by the
  // request URL (the instance config rides along — the start node's contract
  // is declared per instance, so its schemas are derived from it). Draft
  // instances synthesize from their kind.
  const contractQuery = useNodeContract(node);
  const contract = useMemo((): NodeContract | null => {
    const resolved = contractQuery.data;
    if (resolved) return resolved;
    if (
      contractQuery.isPending ||
      contractQuery.isError ||
      !node
    ) {
      return null;
    }
    return {
      key: node.nodeTemplateId,
      label: node.catalog_name ?? node.key,
      kind: node.kind ?? "",
      input: null,
      output: null,
      config: { fields: [], defaults: {} },
    };
  }, [contractQuery.data, contractQuery.isPending, contractQuery.isError, node]);
  return { contractQuery, contract };
}
