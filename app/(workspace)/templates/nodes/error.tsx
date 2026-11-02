"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Template Nodes catalog error boundary: message + retry (AGENTS.md §2.8). */
export default function TemplateNodesError({
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
      logTag="template nodes"
      message="Failed to render the node catalog. Please try again."
    />
  );
}
