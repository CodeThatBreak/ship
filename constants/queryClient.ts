import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query defaults for the app provider and SSR prefetch clients. */
export const QUERY_CLIENT_DEFAULTS = {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  },
} as const;

export const makeServerQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: QUERY_CLIENT_DEFAULTS });
