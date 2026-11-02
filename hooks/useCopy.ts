import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Clipboard copy with a transient "copied" flag — buttons show ✓ for a beat
 * after a successful copy. Failures resolve `false` silently; the caller keeps
 * its on-screen fallback (a reveal toggle, the masked text) instead.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the pending reset timer does not outlive the component
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false; // clipboard unavailable — the caller's fallback applies
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
    return true;
  }, []);
  return { copied, copy };
}
