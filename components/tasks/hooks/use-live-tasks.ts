"use client";
import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { LiveTasksPayload } from "@/types/tasks";

/** Serialize the table's filters + debounced text into the feed's query
 *  string (the route adds `fresh=1` only for forced refreshes). */
export function liveTaskParams(filters: Record<string, string>, text: string): string {
  const params = new URLSearchParams({
    assignee: filters.assignee ?? "me",
    text,
  });
  if (filters.statusCategory) params.set("statusCategory", filters.statusCategory);
  if (filters.provider) params.set("kind", filters.provider);
  return params.toString();
}

/**
 * The runtime task feed behind the tasks table, through TanStack Query:
 * one query per filter-set (the route caches server-side per filter-set for
 * 60s), updating while the filters change.
 *
 * Refetch vs refresh distinction (AGENTS.md §2.8): a filter change keeps the
 * previous list on screen (`placeholderData`) while fetching — the refresh
 * button spins via `refetching || refreshing`, no skeleton. Force refresh
 * (`?fresh=1`) is a mutation that bypasses the route's cache and writes the
 * result back into the active query, so the table updates in place.
 */
export function useLiveTasks(filters: Record<string, string>, text: string) {
  const queryClient = useQueryClient();
  const params = liveTaskParams(filters, text);
  const queryKey = queryKeys.tasks.live(params);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchJson<LiveTasksPayload>(`/api/tasks/live?${params}`),
    placeholderData: keepPreviousData,
  });

  const refresh = useMutation({
    mutationFn: () => fetchJson<LiveTasksPayload>(`/api/tasks/live?${params}&fresh=1`),
    onSuccess: (payload) => queryClient.setQueryData(queryKey, payload),
  });

  /** Force a fresh fetch (also the retry for any feed error). */
  const forceRefresh = useCallback(() => {
    refresh.reset();
    refresh.mutate();
  }, [refresh]);

  const staleError = typeof query.data?.error === "string" ? query.data.error : undefined;

  return {
    tasks: query.data?.tasks ?? [],
    /** the current feed payload (tasks + cache meta for the refresh tooltip) */
    payload: query.data,
    /** first load with nothing to show yet — skeleton time */
    pending: query.isPending,
    /** background refetch of the active filter-set (spinner only) */
    refetching: query.isFetching,
    /** the forced refresh is in flight */
    refreshing: refresh.isPending,
    /** route served a stale list after a failed fresh fetch (banner text) */
    staleError,
    /** the forced refresh failed outright — the previous list stays up */
    refreshError: refresh.error?.message,
    forceRefresh,
  };
}
