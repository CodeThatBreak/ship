"use client";
import { useCallback, useMemo } from "react";
import { useSettingsQuery } from "../../hooks/use-settings-query";
import { usePatchSettings } from "../../general/hooks/use-patch-settings";
import { LOCAL_AGENT } from "../constants";
import type { LocalAgentField } from "../types";

/**
 * Local-run execution settings for the connected harness. Saves through
 * `usePatchSettings` so failures surface through the tab's `onError`.
 */
export const useLocalAgentOptions = (onError: (message: string | null) => void) => {
  const { settings } = useSettingsQuery();
  const patch = usePatchSettings();
  const options = settings?.local_agent ?? null;

  const savingField = useMemo((): LocalAgentField | null => {
    if (!patch.isPending || !patch.variables) return null;
    const partial = patch.variables[LOCAL_AGENT.KEY] as Partial<Record<LocalAgentField, boolean>> | undefined;
    if (!partial) return null;
    if (LOCAL_AGENT.FIELD.FORCE in partial) return LOCAL_AGENT.FIELD.FORCE;
    if (LOCAL_AGENT.FIELD.SANDBOX in partial) return LOCAL_AGENT.FIELD.SANDBOX;
    return null;
  }, [patch.isPending, patch.variables]);

  const toggle = useCallback(
    (field: LocalAgentField) => {
      if (!options || patch.isPending) return;
      patch.mutate(
        { [LOCAL_AGENT.KEY]: { [field]: !options[field] } },
        {
          onSuccess: () => onError(null),
          onError: (e) => onError(e.message),
        },
      );
    },
    [options, patch, onError],
  );

  return { options, savingField, toggle };
};
