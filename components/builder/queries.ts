import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { EditorRepoChoice } from "@/types/template-editor";

type ReposPayload = { repos?: EditorRepoChoice[] };

const loadRepoChoices = async (): Promise<EditorRepoChoice[]> => {
  const payload = await fetchJson<ReposPayload>("/api/repos");
  return (payload.repos ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    local_path: r.local_path ?? null,
  }));
};

export const repoChoicesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.repoChoices,
    queryFn: loadRepoChoices,
  });

export const fetchRepoChoices = loadRepoChoices;
