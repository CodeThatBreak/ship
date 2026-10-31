import { Skeleton } from "@/components/ui/skeleton";

/** Bordered table-card skeleton mirroring DataTable layout (§2.8). */
export const TableSkeleton = ({
  rows,
  withSearch = false,
  columns = 4,
}: {
  rows: number;
  withSearch?: boolean;
  columns?: number;
}) => {
  const table = (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/40 px-4">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton
            key={i}
            className={
              i === columns - 1
                ? "ml-auto h-3 w-14"
                : i === 0
                  ? "h-3 w-14"
                  : "h-3 w-12"
            }
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-11 items-center gap-6 border-b border-border px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-[280px] max-w-1/2" />
          {Array.from({ length: Math.max(1, columns - 1) }, (_, j) => (
            <Skeleton key={j} className="h-4 w-16" />
          ))}
        </div>
      ))}
    </div>
  );

  if (!withSearch) {
    return table;
  }

  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-full max-w-[260px] rounded-lg" />
      {table}
    </div>
  );
};
