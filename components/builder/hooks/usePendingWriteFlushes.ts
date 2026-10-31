"use client";

import { useCallback, useRef } from "react";

/** Registers debounced prompt/config writers so structural Save can flush them first. */
export const usePendingWriteFlushes = () => {
  const flushes = useRef(new Set<() => void>());

  const register = useCallback((flush: () => void) => {
    flushes.current.add(flush);
    return () => {
      flushes.current.delete(flush);
    };
  }, []);

  const flushAll = useCallback(() => {
    for (const flush of flushes.current) flush();
  }, []);

  return { register, flushAll };
};
