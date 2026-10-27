"use client";
import { XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Error state for an instance list that failed to load — message + retry
 *  (AGENTS.md §1.8); the connect modal stays usable while retrying. */
export function InstanceListError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="mb-5">
      <XCircle size={16} />
      <span className="flex-1">Couldn&apos;t load instances — the provider may be unreachable.</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </Alert>
  );
}
