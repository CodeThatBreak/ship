"use client";
import { RefreshCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The plan composer's inline failure rows (prefill error + the invalidated
 * scoped chip): the label plus optional retry/cancel actions. `inline` is
 * the caption row's alert variant (warning, fits the caption width);
 * otherwise it renders the full-width destructive row in the error slot.
 */
export function PlanComposerErrorBlock({
  label,
  onRetry,
  onCancel,
  inline = false,
}: {
  label: string;
  onRetry?: () => void;
  onCancel?: () => void;
  /** inline = the caption row's alert (the invalidated scoped chip) */
  inline?: boolean;
}) {
  return (
    <span
      role="alert"
      className={inline ? "flex flex-1 min-w-0 items-center gap-2" : "flex w-full items-center gap-2"}
    >
      <span className={inline ? "min-w-0 truncate text-warning" : "flex-1 min-w-0 text-destructive"}>
        <RefreshCcwIcon className="mr-1 inline size-3 shrink-0" />
        {label}
      </span>
      {onRetry && (
        <Button type="button" size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onCancel && (
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </span>
  );
}
