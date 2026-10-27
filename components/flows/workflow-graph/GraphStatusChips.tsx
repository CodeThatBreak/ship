"use client";
import { CircleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The graph-definition request's status chips (§2.8): the node cards render
 * from props alone — these only report the edges/meta request.
 */
export function GraphStatusChips({
  isLoading,
  isError,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading graph"
        className="absolute bottom-1 left-1 z-10 flex items-center gap-2 rounded-lg border border-border bg-background/85 px-2 py-1 backdrop-blur"
      >
        <Skeleton className="h-2.5 w-24 rounded-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div
        role="alert"
        className="absolute bottom-1 left-1 z-10 flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-background/85 px-2 py-1 text-[10.5px] text-destructive backdrop-blur"
      >
        <CircleAlert size={11} className="shrink-0" />
        Graph failed to load
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 underline underline-offset-2 transition-colors hover:text-foreground"
        >
          retry
        </button>
      </div>
    );
  }
  return null;
}
