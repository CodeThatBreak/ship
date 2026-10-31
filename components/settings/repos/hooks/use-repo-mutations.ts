"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FAILED_ACTION } from "@/constants/api";
import { queryKeys } from "@/constants/query-keys";
import { apiFetch } from "@/hooks/local-api-token";
import { readError } from "../../queries";
import type { RepoSavePayload } from "../utils/repo-save-payload";

/**
 * Server mutations for the repo registry (/api/repos). Both invalidate the
 * shared `repos` query — the settings provider refetches, so no manual
 * reload plumbing is needed.
 */

/** POST a new repo, or PATCH the existing one when `id` is present. */
async function saveRepo({ id, ...form }: RepoSavePayload): Promise<void> {
  const res = await apiFetch(id ? `/api/repos/${id}` : "/api/repos", {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
}

async function deleteRepo(id: string): Promise<void> {
  const res = await apiFetch(`/api/repos/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, FAILED_ACTION.REMOVE);
}

export function useSaveRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveRepo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.repos }),
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRepo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.repos }),
  });
}
