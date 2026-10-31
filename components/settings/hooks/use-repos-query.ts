"use client";
import { useQuery } from "@tanstack/react-query";
import { errorMessageOf } from "@/hooks/fetch-json";
import type { Repo } from "../context";
import { reposQueryOptions } from "../queries";

const EMPTY_REPOS: Repo[] = [];

/** Cached GET /api/repos — repositories page only. */
export const useReposQuery = () => {
  const query = useQuery(reposQueryOptions());
  return {
    repos: query.data ?? EMPTY_REPOS,
    isPending: query.isPending,
    isError: query.isError,
    errorMessage: errorMessageOf(query.error),
    refetch: () => query.refetch(),
  };
};
