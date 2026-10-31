import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { CatalogModel, ModelChoice } from "@/types/model-spec";

const MODEL_CATALOG_STALE_MS = 60 * 60_000;

/** /api/models payload (catalog backed). */
export type ModelsResponse = {
  models: string[];
  catalog: CatalogModel[];
  source: string;
  default: string | null;
  defaultChoice: ModelChoice | null;
};

/** The flow model catalog, fetched once and cached for the session. */
export const useModelCatalog = () =>
  useQuery({
    queryKey: queryKeys.modelCatalog,
    queryFn: () => fetchJson<ModelsResponse>("/api/models"),
    staleTime: MODEL_CATALOG_STALE_MS,
  });
