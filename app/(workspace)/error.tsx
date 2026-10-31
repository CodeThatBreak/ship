"use client";

import { RouteError } from "@/components/shared";

/** Workspace error boundary (renders inside the sidebar shell). */
export default function WorkspaceError({
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
      logTag="workspace"
      message="This page failed to render. Please try again."
    />
  );
}
