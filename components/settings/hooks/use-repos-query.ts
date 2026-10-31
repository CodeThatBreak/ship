"use client";
import { useQuery } from "@tanstack/react-query";
import { errorMessageOf } from "@/hooks/fetch-json";
import type { Repo } from "@/types/repos";
import type { ReposQueryData } from "../queries";
import { reposQueryOptions } from "../queries";

const EMPTY_REPOS: Repo[] = [];
const EMPTY_REPOS_QUERY: ReposQueryData = { repos: EMPTY_REPOS, serverHome: "" };

/** Cached GET /api/repos — repositories page only. */
export const useReposQuery = () => {
  const query = useQuery(reposQueryOptions());
  const data = query.data ?? EMPTY_REPOS_QUERY;
  return {
    repos: data.repos,
    serverHome: data.serverHome,
    isPending: query.isPending,
    isError: query.isError,
    errorMessage: errorMessageOf(query.error),
    refetch: () => query.refetch(),
  };
};
