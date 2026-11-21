"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Cloud, FlaskConical, FolderGit2, GitMerge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FlowSummary, WorktreeStatus } from "@/types/flows";
import { RUN_MODE } from "@/constants/execution";
import { EXECUTION_MODE_LOCAL } from '../constants';
import { EMPTY_CELL, StatusBadge, WorktreeBadge, FlowStatusDot } from '../flowStatus/flowStatusExports';

/**
 * Column definitions for the flows list. Rebuilt when the polled worktree
 * statuses change (the Branch column reads the current record) — memoize the
 * call's result at the call site. The action column is appended separately
 * through DataTable's `getActions`.
 */
export function flowColumns(
  worktrees: Record<string, WorktreeStatus>,
): ColumnDef<FlowSummary>[] {
  return [
    {
      accessorKey: "taskKey",
      header: "Flow",
      cell: ({ row }) => {
        const f = row.original;
        return (
          <div className="flex items-center gap-2.5 min-w-[240px] max-w-[560px]">
            <FlowStatusDot status={f.status} />
            <span className="font-mono text-[12px] text-info shrink-0">{f.taskKey}</span>
            <span className="block truncate text-[13px] font-medium leading-tight">
              {f.taskSummary}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "mode",
      accessorFn: (f) => f.executionMode ?? "",
      header: "Mode",
      cell: ({ row }) =>
        row.original.executionMode === EXECUTION_MODE_LOCAL ? (
          <Badge variant="outline">
            <FolderGit2 size={11} /> local
          </Badge>
        ) : row.original.executionMode === RUN_MODE.DRY_RUN ? (
          <Badge variant="outline">
            <FlaskConical size={11} /> dry-run
          </Badge>
        ) : (
          <Badge variant="outline">
            <Cloud size={11} /> cloud
          </Badge>
        ),
    },
    {
      id: "worktree",
      header: "Branch",
      enableSorting: false,
      cell: ({ row }) => {
        const f = row.original;
        const wt = worktrees[f.id];
        return f.executionMode === EXECUTION_MODE_LOCAL && wt ? (
          <WorktreeBadge status={wt} />
        ) : (
          EMPTY_CELL
        );
      },
    },
    {
      id: "fanout",
      header: "Fanout",
      enableSorting: false,
      cell: ({ row }) => {
        const fanout = row.original.fanout;
        return fanout?.active ? (
          <Badge
            variant="outline"
            className="gap-1"
            title="This flow is fanned out into step sub-flows — open it to monitor each step"
          >
            <GitMerge size={11} /> {fanout.steps} steps · {fanout.done} merged
          </Badge>
        ) : (
          EMPTY_CELL
        );
      },
    },
    {
      id: "mr",
      header: "MR",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.mrUrl ? (
          <Badge className="bg-violet-500/10 text-violet-400">
            <GitMerge size={11} /> MR open
          </Badge>
        ) : (
          EMPTY_CELL
        ),
    },
  ];
}
