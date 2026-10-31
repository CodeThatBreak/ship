"use client";
import { CircleAlert } from "lucide-react";

/**
 * The graph-definition request's error chip (§2.8): the node cards render
 * from props alone — the initial loading state is the band's skeleton, this
 * only surfaces a failed request over whatever nodes are on screen.
 */
export function GraphStatusChips({
  isError,
  onRetry,
}: {
  isError: boolean;
  onRetry: () => void;
}) {
  if (!isError) return null;

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
