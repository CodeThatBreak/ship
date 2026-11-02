"use client";

import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Inline fetch/load error with retry (§2.8). */
export const InlineError = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => {
  return (
    <div className="flex-1 flex flex-col items-start gap-2 px-4 py-4" role="alert">
      <span className="inline-flex items-center gap-1.5 text-[13px] text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" />
        {message}
      </span>
      <Button size="xs" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
};
