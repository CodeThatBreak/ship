import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { postJson } from "@/hooks/fetch-json";
import type { NodeContract } from "./types";
import type { NodeContractRequest } from "./utils/contract-request";

export const nodeContractQueryOptions = (request: NodeContractRequest) =>
  queryOptions({
    queryKey: queryKeys.nodeContracts(request.cacheKey),
    queryFn: () =>
      postJson<NodeContract>("/api/contracts", JSON.stringify(request.body)),
    staleTime: 30_000,
  });
