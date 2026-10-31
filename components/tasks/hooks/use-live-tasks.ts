"use client";
import { useCallback, useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { errorMessageOf, fetchJson } from "@/hooks/fetch-json";
import { TASK_ASSIGNEE, TASK_FILTER, TASK_PROVIDER_PARAM } from "@/constants/tasks";
import type { LiveTasksPayload } from "@/types/tasks";

/** Serialize the table's filters + debounced text into the feed's query
 *  string (the route adds `fresh=1` only for forced refreshes). */
export const liveTaskParams = (filters: Record<string, string>, text: string): string => {
  const params = new URLSearchParams({
    [TASK_FILTER.ASSIGNEE]: filters[TASK_FILTER.ASSIGNEE] ?? TASK_ASSIGNEE.ME,
    [TASK_FILTER.TEXT]: text,
  });
  if (filters[TASK_FILTER.STATUS_CATEGORY]) {
    params.set(TASK_FILTER.STATUS_CATEGORY, filters[TASK_FILTER.STATUS_CATEGORY]);
  }
  if (filters[TASK_FILTER.PROVIDER]) {
    params.set(TASK_PROVIDER_PARAM, filters[TASK_FILTER.PROVIDER]);
  }
  return params.toString();
};

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
export const useLiveTasks = (filters: Record<string, string>, text: string) => {
  const queryClient = useQueryClient();
  const params = liveTaskParams(filters, text);
  const queryKey = queryKeys.tasks.live(params);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchJson<LiveTasksPayload>(`/api/tasks/live?${params}`),
    placeholderData: keepPreviousData,
  });

  const refreshMutation = useMutation({
    mutationFn: (refreshParams: string) =>
      fetchJson<LiveTasksPayload>(`/api/tasks/live?${refreshParams}&fresh=1`),
    onSuccess: (payload, refreshParams) => {
      queryClient.setQueryData(queryKeys.tasks.live(refreshParams), payload);
    },
  });
  const { mutate: mutateRefresh, reset: resetRefresh } = refreshMutation;

  useEffect(() => {
    resetRefresh();
  }, [params, resetRefresh]);

  /** Force a fresh fetch (also the retry for any feed error). */
  const forceRefresh = useCallback(() => {
    resetRefresh();
    mutateRefresh(params);
  }, [mutateRefresh, params, resetRefresh]);

  const staleError = typeof query.data?.error === "string" ? query.data.error : undefined;
  const queryError = errorMessageOf(query.error);

  return {
    tasks: query.data?.tasks ?? [],
    /** the current feed payload (tasks + cache meta for the refresh tooltip) */
    payload: query.data,
    /** first load with nothing to show yet — skeleton time */
    pending: query.isPending,
    /** background refetch of the active filter-set (spinner only) */
    refetching: query.isFetching,
    /** the forced refresh is in flight */
    refreshing: refreshMutation.isPending,
    /** route served a stale list after a failed fresh fetch (banner text) */
    staleError,
    /** live query failed with no usable payload (banner + empty state) */
    queryError,
    /** the forced refresh failed outright — the previous list stays up */
    refreshError: refreshMutation.error?.message,
    forceRefresh,
  };
};
