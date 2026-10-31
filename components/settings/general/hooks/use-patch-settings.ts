"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { patchSettings } from "../../queries";

/**
 * PATCH /api/settings and invalidate the shared settings query.
 */
export const usePatchSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
};
