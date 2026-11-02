"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Flow cockpit error boundary: message + retry + way back (AGENTS.md §2.8). */
export default function FlowError({
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
      shell="page"
      logTag="flow"
      message="Failed to render this flow. Please try again."
      back={{ href: "/flows", label: "Flows" }}
    />
  );
}
