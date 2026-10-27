import { Skeleton } from "@/components/ui/skeleton";

/** One bordered table card mirroring DataTable's skeleton rows. */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/40 px-4">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-11 items-center gap-6 border-b border-border px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-[280px] max-w-1/2" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

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
            <TableSkeleton rows={4} />
          </div>
        </section>
        <section>
          <SectionHeadingSkeleton />
          <div className="mb-2 opacity-80">
            <TableSkeleton rows={2} />
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end">
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}
