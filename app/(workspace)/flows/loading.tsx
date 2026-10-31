import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Section heading from the flows list (uppercase micro-head with count). */
function SectionHeadingSkeleton() {
  return <Skeleton className="mb-3 h-3 w-28" />;
}

/**
 * Flows list loading state: mirrors the page's header, the Running/Finished
 * sections with their DataTables and the bottom-right Refresh row.
 */
export default function FlowsLoading() {
  return (
    <div aria-busy="true">
      <header className="mb-7">
        <Skeleton className="h-6 w-20 rounded-lg" />
        <Skeleton className="mt-1 h-4 w-[440px]" />
      </header>

      <div className="grid gap-6">
        <section>
          <SectionHeadingSkeleton />
          <div className="mb-2">
            <TableSkeleton rows={4} columns={4} />
          </div>
        </section>
        <section>
          <SectionHeadingSkeleton />
          <div className="mb-2 opacity-80">
            <TableSkeleton rows={2} columns={4} />
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end">
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}
