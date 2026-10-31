"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Search,
  SearchX,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ACTIONS_COLUMN_ID, GRID_BORDERS_CLASS } from "./constants";
import { DataTableActionsCell } from "./DataTableActionsCell";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableSkeletonRows } from "./DataTableSkeletonRows";
import { DataTableTreeCell } from "./DataTableTreeCell";
import type { DataTableAction } from "./types";

export type { DataTableAction } from "./types";

/**
 * Reusable data table on top of the shadcn table primitives.
 */
export const DataTable = <TData, TValue>({
  columns,
  data,
  searchable = false,
  searchPlaceholder = "Search…",
  toolbar,
  emptyMessage = "No results.",
  loading = false,
  pageSize,
  initialSorting = [],
  onRowClick,
  rowClassName,
  className,
  getSubrows,
  getActions,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchable?: boolean;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  pageSize?: number;
  initialSorting?: SortingState;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  className?: string;
  getSubrows?: (row: TData) => TData[] | undefined;
  getActions?: (row: TData) => DataTableAction<TData>[];
}) => {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<ExpandedState>(true);

  const actionsColumn = React.useMemo<ColumnDef<TData, TValue>>(
    () => ({
      id: ACTIONS_COLUMN_ID,
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DataTableActionsCell row={row.original} actions={getActions?.(row.original) ?? []} />
      ),
    }),
    [getActions],
  );
  const allColumns = React.useMemo(
    () => (getActions ? [...columns, actionsColumn] : columns),
    [columns, actionsColumn, getActions],
  );

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter, ...(getSubrows ? { expanded } : {}) },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: getSubrows ? setExpanded : undefined,
    getSubRows: getSubrows,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getSubrows ? { getExpandedRowModel: getExpandedRowModel() } : {}),
    ...(searchable ? { getFilteredRowModel: getFilteredRowModel() } : {}),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    initialState: pageSize ? { pagination: { pageSize } } : undefined,
    globalFilterFn: "includesString",
    enableSortingRemoval: true,
    ...(getSubrows ? { paginateExpandedRows: false } : {}),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {(searchable || toolbar) && (
        <div className="flex items-center gap-2 flex-wrap">
          {toolbar}
          {searchable && (
            <div className="relative w-full max-w-[260px]">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8 h-8"
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table className={GRID_BORDERS_CLASS}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  const sortIcon = canSort ? (
                    <span className="inline-flex items-center text-muted-foreground/70">
                      {dir === "asc" ? (
                        <ChevronUp size={11} />
                      ) : dir === "desc" ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronsUpDown size={11} className="opacity-40" />
                      )}
                    </span>
                  ) : null;

                  return (
                    <TableHead
                      key={header.id}
                      className={cn(canSort && "p-0")}
                      aria-sort={
                        canSort
                          ? dir === "asc"
                            ? "ascending"
                            : dir === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          className="flex h-10 w-full items-center gap-1 px-4 text-left cursor-pointer select-none hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {label}
                          {sortIcon}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">{label}</span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeletonRows table={table} />
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && "cursor-pointer", rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell, i) => {
                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    if (i === 0 && getSubrows) {
                      return (
                        <TableCell key={cell.id}>
                          <DataTableTreeCell row={row} content={content} />
                        </TableCell>
                      );
                    }
                    return <TableCell key={cell.id}>{content}</TableCell>;
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-28 text-center">
                  <span className="inline-flex flex-col items-center gap-1.5 text-muted-foreground">
                    <SearchX size={16} />
                    <span className="text-[13px]">{emptyMessage}</span>
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageSize ? <DataTablePagination table={table} /> : null}
    </div>
  );
};
