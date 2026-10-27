import { Skeleton } from "@/components/ui/skeleton";

/**
 * The modal's loading skeleton (AGENTS.md §2.8): mirrors the loaded layout —
 * prompt header + badges, the body textarea, the rules section, the footer
 * row — same paddings, same element count.
 */
export function PromptModalSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-4 w-2/3" />
      <div className="flex gap-1.5 items-center">
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <div className="grid gap-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
      <div className="rounded-lg border border-border px-3 py-2.5 grid gap-2">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-[60px] w-full rounded-lg" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-16" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-40" />
      </div>
    </div>
  );
}
