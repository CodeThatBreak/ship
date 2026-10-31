import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";

/** Artifact row from GET /api/artifacts — panels read `.content` and `.meta`. */
export type ArtifactDetail = {
  content: string;
  meta?: Record<string, unknown>;
};

export const artifactQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.artifacts.detail(id),
    queryFn: () => fetchJson<ArtifactDetail>(`/api/artifacts/${id}`),
    staleTime: Infinity,
    enabled: id.length > 0,
  });
