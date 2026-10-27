import type { ColumnDef } from "@tanstack/react-table";
import { Blocks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import { KIND_ICONS, isNodeKind, scopeOf } from "../constants";
import type { NodeRow } from "../types";

/**
 * The catalog's table columns (static — hoisted, no per-render identity).
 * BUILT-INS get no row actions at all; custom rows' actions come from
 * `getActions` (DataTable appends the actions column).
 */
export const nodeColumns: ColumnDef<NodeRow>[] = [
  {
    accessorKey: "name",
    header: "Node",
    cell: ({ row }) => {
      const n = row.original;
      const Icon = isNodeKind(n.kind) ? KIND_ICONS[n.kind] : Blocks;
      return (
        <div className="min-w-[220px] max-w-[420px]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon size={12} />
            </span>
            <span className="truncate text-[13px] font-medium">{n.name}</span>
          </div>
          {n.description && (
            <p className="mt-0.5 mb-0 truncate pl-8 text-[12px] text-muted-foreground">
              {n.description}
            </p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "kind",
    header: "Kind",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[11px]">
        {row.original.kind}
      </Badge>
    ),
  },
  {
    id: "scope",
    accessorFn: (n) => scopeOf(n),
    header: "Scope",
    cell: ({ row }) => {
      const scope = scopeOf(row.original);
      return scope === "built-in" ? (
        <Badge className="bg-info/10 text-info">built-in</Badge>
      ) : (
        <Badge variant="outline">{scope}</Badge>
      );
    },
  },
  {
    accessorKey: "version",
    header: "Version",
    cell: ({ row }) => (
      <span className="text-[12px] text-muted-foreground">v{row.original.version}</span>
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
      const rank = (n: NodeRow) => (n.is_builtin ? 0 : 1);
      if (rank(a.original) !== rank(b.original))
        return rank(a.original) - rank(b.original);
      return b.original.updated_at.localeCompare(a.original.updated_at);
    },
  },
];
