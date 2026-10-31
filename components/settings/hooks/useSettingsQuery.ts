"use client";
import { useQuery } from "@tanstack/react-query";
import { errorMessageOf } from "@/hooks/fetchJson";
import { settingsQueryOptions } from "../queries";

/** Cached GET /api/settings — each page waits only on this query when it needs settings. */
export const useSettingsQuery = () => {
  const query = useQuery(settingsQueryOptions());
  return {
    settings: query.data ?? null,
    isPending: query.isPending,
    isError: query.isError,
    errorMessage: errorMessageOf(query.error),
    refetch: () => query.refetch(),
  };
};
