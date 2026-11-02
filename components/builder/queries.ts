import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import type { EditorRepoChoice, EditorTaskProvider } from "@/types/templateEditor";

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

type TaskProvidersPayload = { providers?: EditorTaskProvider[] };

const loadTaskProviders = async (): Promise<EditorTaskProvider[]> => {
  const payload = await fetchJson<TaskProvidersPayload>("/api/tasks/providers");
  return payload.providers ?? [];
};

export const taskProvidersQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.taskProviders,
    queryFn: loadTaskProviders,
  });

export const fetchTaskProviders = loadTaskProviders;
