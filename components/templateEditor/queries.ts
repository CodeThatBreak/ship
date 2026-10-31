import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { postJson } from "@/hooks/fetchJson";
import type { NodeContract } from "./types";
import type { NodeContractRequest } from "./utils/contractRequest";

export const nodeContractQueryOptions = (request: NodeContractRequest) =>
  queryOptions({
    queryKey: queryKeys.nodeContracts(request.cacheKey),
    queryFn: () =>
      postJson<NodeContract>("/api/contracts", JSON.stringify(request.body)),
    staleTime: 30_000,
  });
