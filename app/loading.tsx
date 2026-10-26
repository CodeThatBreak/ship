import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root-segment fallback: the shell layout mounts no chrome, so this mirrors a
 * centered page block (title + copy lines) rather than the eventual route's
 * layout — every real route has a closer, layout-matched loading boundary.
 */
export default function RootLoading() {
  return (
    <div aria-busy="true" className="grid min-h-screen place-items-center bg-background">
      <div className="grid w-full max-w-[520px] gap-3 px-8">
        <Skeleton className="h-6 w-48 rounded-lg" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
