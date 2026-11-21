"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJsonOr } from "../../queries";

/** What DevFlow would apply with no per-repo overrides (see /api/repos/detect). */
export type DetectedPolicy = {
  installCommand: string | null;
  syncPaths: string;
  sharedDirs: string | null;
  source: string;
};

/**
 * Detected worktree policy for one local checkout — shown as placeholders /
 * help text only; never copied into form state. Disabled when the path is empty.
 */
export const useDetectedPolicy = (localPath: string, enabled: boolean) => {
  const trimmed = localPath.trim();
  const query = useQuery({
    queryKey: queryKeys.reposDetect(trimmed),
    queryFn: () =>
      fetchJsonOr<DetectedPolicy | null>(
        `/api/repos/detect?localPath=${encodeURIComponent(trimmed)}`,
        null,
      ),
    enabled: enabled && trimmed.length > 0,
  });
  return query.data ?? null;
};
