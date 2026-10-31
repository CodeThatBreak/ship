import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared";

/**
 * Template Nodes catalog loading state: mirrors the page header (title left,
 * "New node" button right) and the searchable Nodes section.
 */
export default function TemplateNodesLoading() {
  return (
    <div aria-busy="true">
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-36 rounded-lg" />
          <Skeleton className="mt-1 h-4 w-[420px]" />
        </div>
        <Skeleton className="h-8 w-[110px] rounded-lg" />
      </header>

      <section className="mb-6">
        <Skeleton className="mb-3 h-3 w-16" />
        <TableSkeleton rows={6} columns={5} withSearch />
      </section>
    </div>
  );
}
