"use client";
import { useEffect } from "react";
import { XCircle } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Root error boundary: message + retry (AGENTS.md §2.8). Routes with a
 *  closer error.tsx overlay this — this catches everything else. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] uncaught error", error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center p-8">
      <Alert variant="destructive" className="max-w-[640px]">
        <XCircle size={16} />
        <span className="flex-1">
          Something went wrong. Please try again.
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
