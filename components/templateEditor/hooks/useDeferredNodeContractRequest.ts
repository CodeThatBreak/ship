"use client";

import { useDeferredValue, useMemo, useRef } from "react";
import type { EditorNode } from "../types";
import {
  contractConfigSignature,
  contractRelevantConfig,
  nodeContractRequest,
  type NodeContractRequest,
} from "../utils/contractRequest";

type ContractNode = Pick<
  EditorNode,
  "nodeTemplateId" | "kind" | "catalog_name" | "config"
>;

export const useDeferredNodeContractRequest = (
  node: ContractNode | null,
): NodeContractRequest | null => {
  const nodeTemplateId = node?.nodeTemplateId;
  const kind = node?.kind ?? null;
  const catalogName = node?.catalog_name ?? null;
  const configSignature = node ? contractConfigSignature(node.config) : "none";

  const relevantCache = useRef<{
    signature: string;
    value: Record<string, unknown> | null;
  }>({ signature: "none", value: null });
  if (relevantCache.current.signature !== configSignature) {
    relevantCache.current = {
      signature: configSignature,
      value: node ? contractRelevantConfig(node.config) : null,
    };
  }
  const relevantConfig = relevantCache.current.value;
  const deferredConfig = useDeferredValue(relevantConfig);

  return useMemo(() => {
    if (!nodeTemplateId) return null;
    return nodeContractRequest(
      {
        nodeTemplateId,
        kind,
        catalog_name: catalogName,
      },
      deferredConfig,
    );
  }, [nodeTemplateId, kind, catalogName, deferredConfig]);
};
