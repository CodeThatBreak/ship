import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "./fetch-json";
import type { CatalogModel, ModelChoice } from "@/types/model-spec";

// The catalog is normalized server-side by /api/models and effectively static;
// fetched once per session instead of per mount.
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
export function useModelCatalog() {
  return useQuery({
    queryKey: queryKeys.modelCatalog,
    queryFn: () => fetchJson<ModelsResponse>("/api/models"),
    staleTime: MODEL_CATALOG_STALE_MS,
  });
}
