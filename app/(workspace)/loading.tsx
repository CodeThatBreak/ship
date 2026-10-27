import { Skeleton } from "@/components/ui/skeleton";

/**
 * Workspace default (the Tasks page's chrome): a page header, a toolbar row
 * and a bordered table card with a header row + data rows — mirroring the
 * index route's DataTable layout (same paddings, similar element count).
 */
export default function WorkspaceLoading() {
  return (
    <div aria-busy="true">
      <header className="mb-7">
        <Skeleton className="h-6 w-32 rounded-lg" />
        <Skeleton className="mt-1 h-4 w-[420px]" />
      </header>

      <section>
        <Skeleton className="mb-3 h-3 w-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full max-w-[260px] rounded-lg" />
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/40 px-4">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="ml-auto h-3 w-14" />
            </div>
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex h-11 items-center gap-6 border-b border-border px-4 last:border-b-0"
              >
                <Skeleton className="h-4 w-[240px] max-w-1/2" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
