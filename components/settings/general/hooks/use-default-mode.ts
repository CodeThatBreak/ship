"use client";
import { useCallback, useMemo } from "react";
import type { Harness, Settings } from "../../context";
import { usePatchSettings } from "./use-patch-settings";

/** Optional per-call callbacks, same shape TanStack `mutate` accepts. */
type MutationHandlers = {
  onSuccess?: () => void;
  onError?: (e: Error) => void;
};

/**
 * Harness → mode cascade. Each save writes BOTH contract keys atomically
 * (`default_harness` + `default_execution_mode`) — a mode can never dangle on
 * a harness that doesn't offer it. The list is data-driven from
 * `settings.harnesses`; nothing is hardcoded to cloud/local.
 */
export function useDefaultMode(settings: Settings) {
  const patch = usePatchSettings();
  const { mutate } = patch;
  // memoized: `?? []` re-creates the fallback every render, which would churn
  // `saveHarness`'s identity below (react-hooks/exhaustive-deps §2.5)
  const harnesses = useMemo(() => settings.harnesses ?? [], [settings.harnesses]);
  const selectedHarness =
    harnesses.find((h) => h.key === settings.default_harness) ?? null;

  /** Save one mode of one harness (chip click). */
  const saveMode = useCallback(
    (key: string, value: string, handlers?: MutationHandlers) => {
      mutate(
        { default_harness: key, default_execution_mode: value },
        handlers,
      );
    },
    [mutate],
  );

  /** Pick the mode to persist when the harness changes: keep the current
   *  mode if the harness offers it configured, else its first configured
   *  mode. `null` when the harness offers nothing usable — only the harness
   *  key is written then. */
  const modeForHarness = useCallback(
    (h: Harness): string | null => {
      if (h.modes.some((m) => m.value === settings.default_execution_mode && m.configured)) {
        return settings.default_execution_mode;
      }
      return h.modes.find((m) => m.configured)?.value ?? null;
    },
    [settings.default_execution_mode],
  );

  /** Save a harness switch — harness + a usable mode, both in one PATCH. */
  const saveHarness = useCallback(
    (key: string, handlers?: MutationHandlers) => {
      const h = harnesses.find((x) => x.key === key);
      if (!h) return;
      const mode = modeForHarness(h);
      mutate(
        mode ? { default_harness: key, default_execution_mode: mode } : { default_harness: key },
        handlers,
      );
    },
    [harnesses, modeForHarness, mutate],
  );

  return { harnesses, selectedHarness, saveMode, saveHarness, isPending: patch.isPending };
}
