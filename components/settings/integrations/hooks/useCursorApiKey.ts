"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { patchSettings } from "../../queries";

/**
 * Set or clear the Cursor API key (empty string disconnects). The key lives
 * in /api/settings, so success invalidates the shared settings query — every
 * settings sub-route picks up the new status.
 */
export function useUpdateCursorApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      await patchSettings({ cursor_api_key: apiKey });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}
