import { cn } from "../../lib/utils";

/** Inline loading spinner (replaces the old `.spin` CSS class). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-[13px] shrink-0 rounded-full border-2 border-border border-t-accent animate-[sp_0.8s_linear_infinite]",
        className
      )}
    />
  );
}
