import { Skeleton } from "@/components/ui/skeleton";

/** General settings body skeleton — shared by loading.tsx and the client island. */
export const GeneralSettingsSkeleton = () => (
  <div aria-hidden>
    <Skeleton className="h-[44px] w-full rounded-lg mb-8" />

    <Skeleton className="h-4 w-36 rounded-lg mb-3" />
    <div className="grid gap-4 rounded-lg bg-card p-4 ring-1 ring-foreground/5 mb-8">
      <div className="grid gap-2.5">
        <Skeleton className="h-3.5 w-64" />
        <Skeleton className="h-8 w-[280px] rounded-lg" />
        <Skeleton className="h-7 w-[270px] rounded-lg" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="grid gap-2.5 border-t border-border pt-4">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-8 max-w-[280px] w-full rounded-lg" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>

    <Skeleton className="h-4 w-32 rounded-lg mb-3" />
    <div className="grid gap-4 rounded-lg bg-card p-4 ring-1 ring-foreground/5">
      <div className="grid gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-7 w-[112px] rounded-lg" />
        </div>
        <Skeleton className="h-[62px] w-full rounded-lg" />
        <Skeleton className="h-[62px] w-2/3 rounded-lg" />
        <Skeleton className="h-3 w-full" />
      </div>
      <div className="grid gap-2.5 border-t border-border pt-4">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  </div>
);
