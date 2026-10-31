"use client";

import { RouteError } from "@/components/shared/RouteError";

/** Settings error boundary (renders inside the sidebar shell). */
export default function SettingsError({
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
      logTag="settings"
      message="Failed to render the settings page. Please try again."
    />
  );
}
