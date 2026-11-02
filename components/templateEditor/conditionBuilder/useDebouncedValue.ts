"use client";
import { useEffect, useState } from "react";

/**
 * A value delayed by `delayMs` — the time-based debounce shared by the live
 * preview's fetch and the raw box's client-side lint. Holds the previous
 * value until the timer elapses, so consumers don't churn while typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
