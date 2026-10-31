"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Template editor error boundary: message + retry + way back (AGENTS.md §2.8). */
export default function TemplateEditorError({
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
      shell="fixed"
      logTag="template editor"
      message="Failed to render this template. Please try again."
      back={{ href: "/templates", label: "Templates" }}
    />
  );
}
