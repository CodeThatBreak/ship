"use client";
import { useDeferredValue, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { NodeContract } from "@/components/templateEditor/types";
import type { NodeTemplateKind } from "@/components/templateEditor/boilerplate";
import { contractRelevantConfig, kindContractRequest } from "@/components/templateEditor/utils/contractRequest";
import { nodeContractQueryOptions } from "@/components/templateEditor/queries";

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
