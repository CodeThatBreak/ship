import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { NodeContract } from "./types";

export const nodeContractQueryOptions = (url: string) =>
  queryOptions({
    queryKey: queryKeys.nodeContracts(url),
    queryFn: () => fetchJson<NodeContract>(url),
    staleTime: 30_000,
  });
