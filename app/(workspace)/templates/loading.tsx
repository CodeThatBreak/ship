import { Skeleton } from "@/components/ui/skeleton";

/** One bordered table card with a search-input slot + skeleton rows. */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-full max-w-[260px] rounded-lg" />
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/40 px-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-10" />
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
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <TableSkeleton rows={6} />
      </section>
    </div>
  );
}
