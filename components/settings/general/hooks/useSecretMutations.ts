"use client";
import { useCallback } from "react";
import { usePatchSettings } from "./usePatchSettings";

/** Optional per-call callbacks, same shape TanStack `mutate` accepts. */
type SecretHandlers = {
  onSuccess?: () => void;
  onError?: (e: Error) => void;
};

/**
 * Secret mutations. Values are write-only: the API accepts a `{NAME: value}`
 * upsert or `{NAME: null}` delete and answers with names only, so each
 * interaction PATCHes `secrets` independently — present keys update, `null`
 * deletes, absent keys stay untouched.
 */
export function useSecretMutations() {
  const patch = usePatchSettings();
  const { mutate } = patch;

  /**
   * Raw `secrets` PATCH — `entries` maps names to a replacement value or
   * `null` (delete). Used directly by the modal when a rename must write the
   * new name and delete the old one in a single request.
   */
  const patchSecrets = useCallback(
    (entries: Record<string, string | null>, handlers?: SecretHandlers) => {
      mutate({ secrets: entries }, handlers);
    },
    [mutate],
  );

  /** Upsert one secret: `{ secrets: { [name]: value } }`. */
  const upsert = useCallback(
    (name: string, value: string) => {
      patchSecrets({ [name]: value });
    },
    [patchSecrets],
  );

  /** Delete one secret: `{ secrets: { [name]: null } }`. */
  const remove = useCallback(
    (name: string) => {
      patchSecrets({ [name]: null });
    },
    [patchSecrets],
  );

  return { patchSecrets, upsert, remove, isPending: patch.isPending };
}
