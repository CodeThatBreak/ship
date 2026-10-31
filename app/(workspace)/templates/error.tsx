"use client";

import { RouteError } from "@/components/shared";

/** Templates gallery error boundary: message + retry (AGENTS.md §2.8). */
export default function TemplatesError({
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
      logTag="templates"
      message="Failed to render the template gallery. Please try again."
    />
  );
}
