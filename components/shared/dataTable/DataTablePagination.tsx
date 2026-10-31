import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";

export const DataTablePagination = <TData,>({ table }: { table: Table<TData> }) => {
  if (table.getPageCount() <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
      <span>
        {table.getFilteredRowModel().rows.length} rows · page{" "}
        {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous page"
        onClick={() => table.previousPage()}
        disabled={!table.getCanPreviousPage()}
      >
        <ChevronLeft size={13} />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next page"
        onClick={() => table.nextPage()}
        disabled={!table.getCanNextPage()}
      >
        <ChevronRight size={13} />
      </Button>
    </div>
  );
};
