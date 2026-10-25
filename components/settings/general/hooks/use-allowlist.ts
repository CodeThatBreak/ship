"use client";
import { useCallback, useState } from "react";
import { usePatchSettings } from "./use-patch-settings";

/**
 * HTTP allowlist state + save. One hostname per line, blank lines ignored,
 * PATCHed as `http_allowlist: string[]`. The local text is seeded from the
 * saved value via a `key`-reset at the call site (AGENTS.md §1.4) — no
 * useEffect state mirroring.
 */
export function useAllowlist(initial: string[]) {
  const patch = usePatchSettings();
  const [text, setText] = useState(initial.join("\n"));

  /** PATCH `http_allowlist` — present keys update, the whole list replaces. */
  const save = useCallback(
    (handlers?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      patch.mutate(
        { http_allowlist: text.split("\n").map((h) => h.trim()).filter(Boolean) },
        handlers,
      );
    },
    [patch.mutate, text],
  );

  const dirty = text !== initial.join("\n");

  return { text, setText, dirty, save, isPending: patch.isPending };
}
