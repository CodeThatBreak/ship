"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { patchSettings } from "../../queries";

/**
 * PATCH /api/settings and invalidate the shared settings query. The provider
 * refetches, so consumers read the fresh `Settings` straight from the cache.
 */
export function usePatchSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}
