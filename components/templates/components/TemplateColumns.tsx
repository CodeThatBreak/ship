import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FLOW_TRIGGER_TYPE } from "@/components/templateEditor/constants";
import { fmtDate } from "@/lib/format";
import { nodeCountLabel } from "../constants";
import type { TemplateRow } from "../types";

/**
 * The gallery's table columns (static — hoisted, no per-render identity).
 * The row-actions column is appended by DataTable from `getActions`.
 */
export const templateColumns: ColumnDef<TemplateRow>[] = [
  {
    accessorKey: "name",
    header: "Template",
    cell: ({ row }) => {
      const t = row.original;
      return (
        <div className="min-w-[220px] max-w-[420px]">
          <Link href={`/templates/${t.id}`} className="group/name flex min-w-0 items-center gap-2">
            <span className="inline-grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Workflow size={12} />
            </span>
            <span className="truncate text-[13px] font-medium group-hover/name:underline">
              {t.name}
            </span>
          </Link>
          {t.description && (
            <p className="mt-0.5 mb-0 truncate pl-8 text-[12px] text-muted-foreground">
              {t.description}
            </p>
          )}
        </div>
      );
    },
  },
  {
    id: "type",
    accessorFn: (t) => (Boolean(t.is_builtin) ? "built-in" : "custom"),
    header: "Type",
    cell: ({ row }) =>
      Boolean(row.original.is_builtin) ? (
        <Badge className="bg-info/10 text-info">built-in</Badge>
      ) : (
        <Badge variant="outline">custom</Badge>
      ),
  },
  {
    id: "trigger",
    accessorFn: (t) => FLOW_TRIGGER_TYPE[String(t.trigger?.type ?? "manual")] ?? "manual / webhook",
    header: "Trigger",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[11px]">
        {FLOW_TRIGGER_TYPE[String(row.original.trigger?.type ?? "manual")] ?? "manual / webhook"}
      </Badge>
    ),
  },
  {
    accessorKey: "nodeCount",
    header: "Nodes",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[11px]">
        {nodeCountLabel(row.original.nodeCount)}
      </Badge>
    ),
  },
  {
    accessorKey: "updated_at",
    header: "Updated",
    cell: ({ row }) => (
      <span className="text-[12px] text-muted-foreground">
        {fmtDate(row.original.updated_at) || "—"}
      </span>
    ),
    // default view: built-ins pinned first, newest within each group
    sortingFn: (a, b) => {
      const rank = (isBuiltin: number) => (Boolean(isBuiltin) ? 0 : 1);
      if (rank(a.original.is_builtin) !== rank(b.original.is_builtin))
        return rank(a.original.is_builtin) - rank(b.original.is_builtin);
      return b.original.updated_at.localeCompare(a.original.updated_at);
    },
  },
];
