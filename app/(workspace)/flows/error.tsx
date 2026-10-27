"use client";
import { useEffect } from "react";
import { XCircle } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Flows list error boundary: message + retry (AGENTS.md §2.8). */
export default function FlowsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[flows] uncaught error", error);
  }, [error]);

  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Alert variant="destructive" className="max-w-[640px]">
        <XCircle size={16} />
        <span className="flex-1">
          Failed to render the flows list. Please try again.
          {error.digest && (
            <span className="block text-[11px] opacity-70">ref: {error.digest}</span>
          )}
        </span>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={reset}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
