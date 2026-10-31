import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared";

/**
 * Templates gallery loading state: mirrors the page header (title left,
 * action buttons right) and the searchable Templates section.
 */
export default function TemplatesLoading() {
  return (
    <div aria-busy="true">
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-32 rounded-lg" />
          <Skeleton className="mt-1 h-4 w-[380px]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-[132px] rounded-lg" />
          <Skeleton className="h-8 w-[112px] rounded-lg" />
          <Skeleton className="h-8 w-[120px] rounded-lg" />
        </div>
      </header>

      <section className="mb-6">
        <Skeleton className="mb-3 h-3 w-24" />
        <TableSkeleton rows={6} columns={5} withSearch />
      </section>
    </div>
  );
}
