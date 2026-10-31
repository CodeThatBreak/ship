"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { CornerDownRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableAction } from "@/components/shared/dataTable/DataTable";
import type { LiveTask } from "@/types/tasks";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";
import { TypeChip } from "./TypeChip";

// table columns — they read the row only, so they live at module scope (no
// per-render column rebuild). The action column comes through `getActions`.
const COLUMNS: ColumnDef<LiveTask>[] = [
  {
    accessorKey: "key",
    header: "Task",
    cell: ({ row }) => {
      const t = row.original;
      return (
        <div className="flex items-center gap-2.5 min-w-[280px] max-w-[560px]">
          <TypeChip task={t} />
          <div className="min-w-0">
            <span className="block truncate text-[13px] font-medium leading-tight">
              {t.summary}
            </span>
            {t.parentKey && row.depth === 0 && (
              <span className="flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70 font-mono">
                <CornerDownRight size={9} /> {t.parentKey}
              </span>
            )}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "issueType",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[11px]">
        {row.original.issueType || "—"}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
  },
];

/**
 * The tasks grid: sorted sub-task tree with pagination. Purely presentational
 * — filtering state and the build action stay with the container.
 */
export function TasksTable({ tasks, loading, childrenByParent, getActions, toolbar, emptyMessage }: {
  tasks: LiveTask[];
  /** skeleton rows only while nothing has loaded (first paint / no cache) */
  loading: boolean;
  /** parent key → its children in the current result set (sub-task tree) */
  childrenByParent: Map<string, LiveTask[]>;
  getActions: (task: LiveTask) => DataTableAction<LiveTask>[];
  toolbar: React.ReactNode;
  emptyMessage: string;
}) {
  return (
    <DataTable
      columns={COLUMNS}
      getActions={getActions}
      data={tasks}
      loading={loading}
      pageSize={25}
      initialSorting={[{ id: "key", desc: false }]}
      getSubrows={(t) => childrenByParent.get(t.key)}
      emptyMessage={emptyMessage}
      toolbar={toolbar}
    />
  );
}
