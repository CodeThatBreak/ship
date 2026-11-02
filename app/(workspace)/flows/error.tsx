"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Flows list error boundary: message + retry (AGENTS.md §2.8). */
export default function FlowsError({
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
      shell="workspace"
      logTag="flows"
      message="Failed to render the flows list. Please try again."
    />
  );
}
