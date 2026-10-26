"use client";
import { useCallback, useState } from "react";
import { useSettings } from "../../context";
import { LOCAL_AGENT } from "../constants";
import type { LocalAgentField } from "../types";

/**
 * Local-run execution settings for the connected harness (moved from the
 * General page). Reads `settings.local_agent`, saves through the shared
 * `saveSettings` (PATCH /api/settings + invalidate) and only ever sends a
 * single-field partial patch (`{ local_agent: { force } }` …).
 *
 * `savingField` doubles as the optimistic disabled signal: while a toggle is
 * in flight, every control is disabled so the next click can't be computed
 * from a stale snapshot that the pending invalidate would overwrite.
 */
export function useLocalAgentOptions() {
  const { settings, saveSettings } = useSettings();
  const options = settings?.local_agent ?? null;
  const [savingField, setSavingField] = useState<LocalAgentField | null>(null);

  /** Flip one boolean field and PATCH it as a partial local_agent update. */
  const toggle = useCallback(
    (field: LocalAgentField) => {
      if (!options || savingField !== null) return;
      setSavingField(field);
      void saveSettings({
        [LOCAL_AGENT.KEY]: { [field]: !options[field] },
      }).finally(() => setSavingField(null));
    },
    [options, saveSettings, savingField],
  );

  return { options, savingField, toggle };
}
