"use client";
/** The preview line's loading pulse — mirrors the line's layout (same
 *  indent, same text size) while the evaluation is in flight. */
export function PreviewLineSkeleton({ prefix = "=" }: { prefix?: string }) {
  return (
    <p className="text-[11px] text-muted-foreground m-0 flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-muted-foreground/40" />
      {prefix} evaluating…
    </p>
  );
}
