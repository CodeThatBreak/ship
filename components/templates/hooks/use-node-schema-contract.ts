"use client";
import { useDeferredValue, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type NodeContract,
  type NodeTemplateKind,
  contractRelevantConfig,
  kindContractRequest,
  nodeContractQueryOptions,
} from "@/components/template-editor";

export const useNodeSchemaContract = (
  kind: NodeTemplateKind,
  config: Record<string, unknown>,
): NodeContract | null => {
  const relevantConfig = useMemo(
    () => contractRelevantConfig(config),
    [config],
  );
  const deferredConfig = useDeferredValue(relevantConfig);
  const request = useMemo(
    () => kindContractRequest(kind, deferredConfig),
    [kind, deferredConfig],
  );
  const { data } = useQuery({
    ...nodeContractQueryOptions(request),
    retry: false,
    placeholderData: keepPreviousData,
  });

  if (!data || !("input" in data)) return null;
  return data;
};
