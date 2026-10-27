import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";

/** An artifact row as returned by /api/artifacts — the shape varies by kind, so
 *  the reader (the panel) narrows it. */
export type Artifact = Record<string, unknown>;

/**
 * Imperative artifact lookup passed to every panel (the panels stay
 * transport-free). Reads through the TanStack Query cache — reopening the same
 * artifact hits the cache instead of the network.
 */
export function useArtifactFetcher() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string): Promise<Artifact> =>
      queryClient.fetchQuery({
        queryKey: queryKeys.artifacts.detail(id),
        queryFn: async () => {
          const res = await fetch(`/api/artifacts/${id}`);
          // the previous helper returned the raw body regardless of status —
          // keep the same (lenient) contract for the panels that read it
          return (await res.json()) as Artifact;
        },
      }),
    [queryClient],
  );
}
