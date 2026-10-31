"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import type { WorktreeStatus } from "@/types/flows";

/** Poll cadence — flow events land in the DB and rows pick the git state up. */
const WORKTREE_POLL_MS = 5000;

type WorktreeStatusPayload = { statuses?: Record<string, WorktreeStatus> };

/**
 * Per-flow worktree status (dirty / ahead / behind) for local flows, polled
 * every few seconds while any local flow exists. `placeholderData` keeps the
 * previous statuses visible between polls (no flicker).
 */
export function useWorktreeStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.flows.worktreeStatus,
    queryFn: async () => {
      const payload = await fetchJson<WorktreeStatusPayload>("/api/flows/worktree-status");
      return payload.statuses ?? {};
    },
    enabled,
    staleTime: 0,
    refetchInterval: WORKTREE_POLL_MS,
    placeholderData: keepPreviousData,
  });
}
