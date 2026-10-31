"use client";
/**
 * A trailing-edge debounced callback (no new deps): the latest call's args
 * wait `delay` ms of quiet, then fire. The callback identity is stable —
 * its `fn` rides a ref refreshed every render, so inline handlers stay safe
 * to pass without `useCallback` shims, and the hook takes its args per call
 * (one instance can serve several call sites that differ in arguments).
 *
 * Used for the prompt body's config writes (use-template-draft.ts chains a
 * draft change into a re-keyed /api/contracts fetch — per-keystroke writes
 * refetch the contract chaotically; the diagram keeps its linter warm, the
 * network stays cold). On unmount the pending call flushes first, so the
 * typed tail survives closing the drawer or switching tabs mid-burst.
 */
import { useCallback, useEffect, useRef } from "react";

export type DebouncedCallback<Args extends unknown[]> = {
  invoke: (...args: Args) => void;
  /** Run the pending trailing call immediately (or no-op if none). */
  flush: () => void;
};

export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): DebouncedCallback<Args> {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const pending = useRef<Args | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const args = pending.current;
    pending.current = null;
    if (args) fnRef.current(...args);
  }, []);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  const invoke = useCallback(
    (...args: Args) => {
      pending.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        pending.current = null;
        fnRef.current(...args);
      }, delay);
    },
    [delay],
  );

  return { invoke, flush };
}
