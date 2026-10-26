"use client";
/**
 * The builder's inline error state (the client island's detail query failed
 * after hydration — a stale route, a refetch gone wrong): message, retry and
 * the way back to the gallery (§2.8). The route-level error boundary stays
 * in app/templates/[id]/error.tsx.
 */
import Link from "next/link";
import { ArrowLeft, XCircle } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface EditorErrorProps {
  message: string;
  detail?: string;
  onRetry: () => void;
}

export function EditorError({ message, detail, onRetry }: EditorErrorProps) {
  return (
    <main className="p-6">
      <Alert variant="destructive" className="max-w-[640px]">
        <XCircle size={16} />
        <span className="flex-1">
          {message}
          {detail && (
            <span className="block text-[11px] opacity-70">{detail}</span>
          )}
        </span>
        <AlertAction>
          <Button size="sm" variant="outline" render={<Link href="/templates" />}>
            <ArrowLeft size={13} /> Templates
          </Button>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    </main>
  );
}
