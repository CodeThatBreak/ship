import type { Table } from "@tanstack/react-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const DataTableSkeletonRows = <TData,>({
  table,
}: {
  table: Table<TData>;
}) => (
  <>
    {[...Array(6)].map((_, i) => (
      <TableRow key={i}>
        {table.getVisibleLeafColumns().map((col, j) => (
          <TableCell key={col.id}>
            <span
              className={cn(
                "block h-4 animate-pulse rounded-lg bg-muted",
                j === 0 ? "w-3/4" : "w-1/2",
              )}
            />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
);
