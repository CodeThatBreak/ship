"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type NodeContract,
  type NodeTemplateKind,
  kindContractUrl,
  nodeContractQueryOptions,
} from "@/components/template-editor";

export const useNodeSchemaContract = (
  kind: NodeTemplateKind,
  config: Record<string, unknown>,
): NodeContract | null => {
  const url = kindContractUrl(kind, config);
  const { data } = useQuery({
    ...nodeContractQueryOptions(url),
    retry: false,
    placeholderData: keepPreviousData,
  });

  if (!data || !("input" in data)) return null;
  return data;
};
