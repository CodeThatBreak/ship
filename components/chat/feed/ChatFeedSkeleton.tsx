import { Skeleton } from "@/components/ui/skeleton";

/** Transcript request state (§2.8): loading — bubble skeletons mirroring the
 *  chat feed layout (user right, agent left); never wire skeleton rows to
 *  live data. */
export default function ChatFeedSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading chat"
      className="flex-1 flex flex-col gap-6 pl-4 pr-7.5 py-4"
    >
      <div className="flex justify-end">
        <Skeleton className="h-9 w-36 rounded-2xl" />
      </div>
      <Skeleton className="h-16 w-2/3 rounded-2xl" />
      <div className="flex justify-end">
        <Skeleton className="h-8 w-24 rounded-2xl" />
      </div>
      <Skeleton className="h-10 w-1/2 rounded-2xl" />
    </div>
  );
}
