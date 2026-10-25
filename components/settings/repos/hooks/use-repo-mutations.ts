"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FAILED_ACTION } from "@/constants/api";
import { queryKeys } from "@/constants/query-keys";
import { readError } from "../../queries";
import type { RepoFormState } from "../types";

/**
 * Server mutations for the repo registry (/api/repos). Both invalidate the
 * shared `repos` query — the settings provider refetches, so no manual
 * reload plumbing is needed.
 */

type SavePayload = RepoFormState & { id?: string | null };

/** POST a new repo, or PATCH the existing one when `id` is present. */
async function saveRepo({ id, ...form }: SavePayload): Promise<void> {
  const res = await fetch(id ? `/api/repos/${id}` : "/api/repos", {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
}

async function deleteRepo(id: string): Promise<void> {
  const res = await fetch(`/api/repos/${id}`, { method: "DELETE" });
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
