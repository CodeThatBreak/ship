import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton mirroring the thread cards (header row + body lines). */
export const ThreadListSkeleton = () => (
  <div className="grid gap-2.5 mt-1">
    {[0, 1].map((i) => (
      <Card key={i} className="p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="ml-auto h-3 w-10 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-11/12 mb-1.5 rounded-full" />
        <Skeleton className="h-3.5 w-2/3 mb-1.5 rounded-full" />
        <Skeleton className="h-3.5 w-1/2 rounded-full" />
      </Card>
    ))}
  </div>
);
