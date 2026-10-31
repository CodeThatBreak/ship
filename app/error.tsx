"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Root error boundary: message + retry (AGENTS.md §2.8). Routes with a
 *  closer error.tsx overlay this — this catches everything else. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      shell="root"
      logTag="app"
      message="Something went wrong. Please try again."
    />
  );
}
