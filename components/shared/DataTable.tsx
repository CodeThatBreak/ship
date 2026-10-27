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
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  Search,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "cn";

/** Full-grid look: vertical separators between every column (the horizontal
 *  separators come from the table primitives' row borders). Tailwind v4
 *  defaults border color to currentColor, so the theme border color is set
 *  here explicitly to match the row separators. */
const GRID_BORDERS_CLASS =
  "[&_th]:border-r [&_th]:border-border [&_th]:last:border-r-0 " +
  "[&_td]:border-r [&_td]:border-border [&_td]:last:border-r-0";

/** id of the generated row-actions column (see `getActions`). */
const ACTIONS_COLUMN_ID = "actions";

/**
 * One row action for the built-in actions column (see `getActions`).
 * The first action renders as an upfront button; everything after it
 * collapses into the ⋯ overflow menu.
 */
export type DataTableAction<TData> = {
  label: string;
  /** Icon rendered before the label (in the button and in the menu item). */
  icon?: React.ReactNode;
  /** Native tooltip explaining the action. */
  title?: string;
  disabled?: boolean;
  /** Renders in the destructive color inside the overflow menu. */
  destructive?: boolean;
  /** Click handler — omit when the action is a plain navigation via `href`. */
  onSelect?: (row: TData) => void;
  /** Renders the action as a link to this href (e.g. a file export). */
  href?: (row: TData) => string;
};

/**
 * Reusable data table on top of the shadcn table primitives.
 *
 * Gives any dataset: sorting (click the headers), an optional built-in
 * search input (client-side global filter) and pagination — plus a `toolbar`
 * slot for custom controls next to the search box. Fully controlled data:
 * server-driven pages (e.g. runtime-fetched tasks) pass their own state and
 * keep the client filter off. Row actions go through `getActions`: the first
 * action renders as an upfront button, the rest collapse into a ⋯ menu.
 */
export function DataTable<TData, TValue>({
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
  /** Render a built-in global search input (client-side filter). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Extra controls rendered left of the search input (or alone when search is off). */
  toolbar?: React.ReactNode;
  emptyMessage?: React.ReactNode;
  /** Show skeleton rows instead of the (not yet loaded) data. */
  loading?: boolean;
  /** Rows per page; omit for no pagination. */
  pageSize?: number;
  initialSorting?: SortingState;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  className?: string;
  /** Return a row's children (e.g. sub-tasks) to render as an expandable tree. */
  getSubrows?: (row: TData) => TData[] | undefined;
  /** Per-row actions in a trailing column: the first action renders as an
   *  upfront button, the rest collapse into a ⋯ overflow menu. Rows whose
   *  action list is empty render nothing. Memoize this callback so the
   *  generated column stays referentially stable. */
  getActions?: (row: TData) => DataTableAction<TData>[];
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<ExpandedState>(true); // start fully expanded

  // built-in actions column: first action upfront, the rest under ⋯
  const actionsColumn = React.useMemo<ColumnDef<TData, TValue>>(
    () => ({
      id: ACTIONS_COLUMN_ID,
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <ActionsCell row={row.original} actions={getActions?.(row.original) ?? []} />
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
    // with tree rows, paginate top-level rows only — children always render
    // on the same page as their parent (never split across a page break)
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
                  return (
                    <TableHead
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={cn(canSort && "cursor-pointer select-none hover:text-foreground")}
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="inline-flex items-center text-muted-foreground/70">
                            {dir === "asc" ? (
                              <ChevronUp size={11} />
                            ) : dir === "desc" ? (
                              <ChevronDown size={11} />
                            ) : (
                              <ChevronsUpDown />
                            )}
                          </span>
                        )}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(6)].map((_, i) => (
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
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell, i) => {
                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    // first column carries the tree chrome: depth indent + expand toggle
                    if (i === 0 && getSubrows) {
                      const canExpand = row.getCanExpand();
                      return (
                        <TableCell key={cell.id}>
                          <div
                            className="flex items-center"
                            style={{ paddingLeft: row.depth * 18 }}
                          >
                            {canExpand ? (
                              <button
                                type="button"
                                aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
                                title={row.getIsExpanded() ? "Collapse" : "Expand"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  row.toggleExpanded();
                                }}
                                className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                              >
                                <ChevronRight
                                  size={12}
                                  className={cn(
                                    "transition-transform",
                                    row.getIsExpanded() && "rotate-90",
                                  )}
                                />
                              </button>
                            ) : (
                              <span className="mr-1 inline-block h-4 w-4 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">{content}</div>
                          </div>
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

      {pageSize && table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
          <span>
            {table.getFilteredRowModel().rows.length} rows · page{" "}
            {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft size={13} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Upfront button + ⋯ overflow menu for one row's actions (see `getActions`). */
function ActionsCell<TData>({
  row,
  actions,
}: {
  row: TData;
  actions: DataTableAction<TData>[];
}) {
  if (actions.length === 0) return null;
  const [primary, ...overflow] = actions;
  const href = primary.href;
  const onSelect = primary.onSelect;
  return (
    <div
      className="flex items-center justify-end gap-1"
      // keep row-level click handlers (onRowClick) out of the action controls
      onClick={(e) => e.stopPropagation()}
    >
      {href ? (
        <a href={href(row)} title={primary.title}>
          <Button size="sm" variant="outline" disabled={primary.disabled}>
            {primary.icon}
            {primary.label}
          </Button>
        </a>
      ) : (
        <Button
          size="sm"
          variant="outline"
          title={primary.title}
          disabled={primary.disabled}
          onClick={() => onSelect?.(row)}
        >
          {primary.icon}
          {primary.label}
        </Button>
      )}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
                title="More actions"
              />
            }
          >
            <Ellipsis size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[150px]">
            {overflow.map((action) => {
              const href = action.href;
              const onSelect = action.onSelect;
              return (
                <DropdownMenuItem
                  key={action.label}
                  variant={action.destructive ? "destructive" : "default"}
                  disabled={action.disabled}
                  title={action.title}
                  onClick={
                    href
                      ? () => window.location.assign(href(row))
                      : onSelect
                        ? () => onSelect(row)
                        : undefined
                  }
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Unsorted-state placeholder icon (kept inline so imports stay lean). */
function ChevronsUpDown() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-40"
    >
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}
