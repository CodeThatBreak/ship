"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, XCircle } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Template editor error boundary: message + retry + way back (AGENTS.md §2.8). */
export default function TemplateEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[template editor] uncaught error", error);
  }, [error]);

  return (
    <main className="fixed inset-0 grid place-items-center p-8">
      <Alert variant="destructive" className="max-w-[640px]">
        <XCircle size={16} />
        <span className="flex-1">
          Failed to render this template. Please try again.
          {error.digest && (
            <span className="block text-[11px] opacity-70">ref: {error.digest}</span>
          )}
        </span>
        <AlertAction>
          <Button size="sm" variant="outline" render={<Link href="/templates" />}>
            <ArrowLeft size={13} /> Templates
          </Button>
          <Button size="sm" variant="outline" onClick={reset}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    </main>
  );
}
