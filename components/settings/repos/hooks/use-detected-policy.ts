"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "../../queries";

/** What DevFlow would apply with no per-repo overrides (see /api/repos/detect). */
export type DetectedPolicy = {
  install_command: string | null;
  sync_paths: string;
  shared_dirs: string | null;
  source: string;
};

/**
 * Detected worktree policy for one local checkout — used to prefill the repo
 * form's empty policy fields so the user sees what's going to be applied.
 * Resilient: any failure just means no prefill.
 */
export function useDetectedPolicy(localPath: string, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.reposDetect(localPath),
    queryFn: () =>
      fetchJson<DetectedPolicy | null>(
        `/api/repos/detect${localPath ? `?local_path=${encodeURIComponent(localPath)}` : ""}`,
        null,
      ),
    enabled,
  });
  return query.data ?? null;
}
