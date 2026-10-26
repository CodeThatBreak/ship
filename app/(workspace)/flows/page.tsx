"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Cloud,
  FolderGit2,
  GitMerge,
  Inbox,
  SquareCheckBig,
  Workflow,
} from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableAction } from "@/components/data-table";
import { cn } from "cn";

/** Flow status buckets — §1.6: one named constant, compared in 2+ places. */
const FLOW_STATUS_ACTIVE = "active";
/** Execution modes rendered in the Mode/Branch columns. */
const EXECUTION_MODE_LOCAL = "local";

type Flow = {
  id: string;
  task_id: string;
  name: string;
  status: string;
  task_key: string;
  task_summary: string;
  mr_url?: string;
  execution_mode?: string;
  /** plan fan-out (Phase 4): step-progress summary when a checklist is linked
   *  to step sub-flows (`active` = children still unresolved) */
  fanout?: { steps: number; done: number; active: boolean };
};

type WorktreeStatus = {
  path: string;
  registered: boolean;
  branch?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  pushed?: boolean;
  stat?: string;
  mrBranch?: string | null;
  reason?: string;
};

function statusStyle(status: string): { className: string; label: string } {
  const s = (status ?? "").toLowerCase();
  if (/done|closed|resolved|complete/.test(s))
    return { className: "bg-success/10 text-success", label: "done" };
  if (/active|progress|review|testing/.test(s))
    return { className: "bg-info/10 text-info", label: "active" };
  if (/block|hold/.test(s))
    return { className: "bg-destructive/10 text-destructive", label: "blocked" };
  return { className: "bg-zinc-500/10 text-zinc-400", label: "todo" };
}

function StatusBadge({ status }: { status: string }) {
  const { className, label } = statusStyle(status);
  return <Badge className={className}>{status ? label : "—"}</Badge>;
}

/** Worktree state for one local flow row: branch, dirty dot, ahead/behind. */
function WorktreeBadge({ status }: { status: WorktreeStatus }) {
  if (!status.registered) {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 text-warning"
        title={`Code workspace not ready yet${status.reason ? `: ${status.reason}` : ""}`}
      >
        <FolderGit2 size={11} /> unavailable
      </Badge>
    );
  }
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const title =
    `${status.branch ?? "(detached)"}` +
    (status.dirty ? " · uncommitted changes" : " · clean") +
    (ahead ? ` · ${ahead} commit${ahead === 1 ? "" : "s"} ahead` : "") +
    (behind ? ` · ${behind} behind` : "") +
    (status.pushed ? " · pushed" : " · not pushed");
  return (
    <Badge
      variant="outline"
      title={title}
      className="max-w-[240px] gap-1 font-mono text-[11px]"
    >
      <FolderGit2 size={11} />
      <span className="truncate">{status.branch ?? "detached"}</span>
      {status.dirty && <span className="size-1.5 shrink-0 rounded-full bg-warning" />}
      {ahead > 0 && <span className="text-success">↑{ahead}</span>}
      {behind > 0 && <span className="text-warning">↓{behind}</span>}
    </Badge>
  );
}

/** Empty-cell placeholder for columns whose feature may be absent. */
const EMPTY_CELL = <span className="text-muted-foreground/50">—</span>;

export default function FlowsPage() {
  const router = useRouter();
  // null = not loaded yet (DataTable shows skeleton rows until the first fetch)
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeStatus>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const f = await fetch("/api/flows").then((r) => r.json());
      setFlows(f.flows ?? []);
    } catch {
      setError("Failed to load flows. Please try again.");
      setFlows([]); // end the skeleton even on failure
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Worktree status (dirty / ahead / behind) for local flows: refreshed every
  // 5s — flow events land in the DB and the rows pick the git state up here.
  const loadWorktrees = useCallback(async () => {
    const r = await fetch("/api/flows/worktree-status").then((r) => r.json()).catch(() => null);
    setWorktrees(r?.statuses ?? {});
  }, []);

  useEffect(() => {
    if (!flows?.some((f) => f.execution_mode === EXECUTION_MODE_LOCAL)) return;
    loadWorktrees();
    const t = setInterval(loadWorktrees, 5000);
    return () => clearInterval(t);
  }, [flows, loadWorktrees]);

  const openFlow = useCallback(
    (f: Flow) => router.push(`/flows/${f.id}`),
    [router],
  );

  const columns = useMemo<ColumnDef<Flow>[]>(
    () => [
      {
        accessorKey: "task_key",
        header: "Flow",
        cell: ({ row }) => {
          const f = row.original;
          return (
            <div className="flex items-center gap-2.5 min-w-[240px] max-w-[560px]">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  f.status === FLOW_STATUS_ACTIVE
                    ? "bg-success shadow-[0_0_8px] shadow-success/60 animate-pulse"
                    : "bg-zinc-600",
                )}
              />
              <span className="font-mono text-[12px] text-info shrink-0">{f.task_key}</span>
              <span className="block truncate text-[13px] font-medium leading-tight">
                {f.task_summary}
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
        accessorFn: (f) => f.execution_mode ?? "",
        header: "Mode",
        cell: ({ row }) =>
          row.original.execution_mode === EXECUTION_MODE_LOCAL ? (
            <Badge variant="outline">
              <FolderGit2 size={11} /> local
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
          return f.execution_mode === EXECUTION_MODE_LOCAL && wt ? (
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
          row.original.mr_url ? (
            <Badge className="bg-violet-500/10 text-violet-400">
              <GitMerge size={11} /> MR open
            </Badge>
          ) : (
            EMPTY_CELL
          ),
      },
    ],
    [worktrees],
  );

  // row actions — the DataTable renders the first action as an upfront button
  // and any further ones in a ⋯ menu (flows have a single action today)
  const getActions = useCallback(
    (f: Flow): DataTableAction<Flow>[] => [{ label: "Open", onSelect: () => openFlow(f) }],
    [openFlow],
  );

  const active = (flows ?? []).filter((f) => f.status === FLOW_STATUS_ACTIVE);
  const finished = (flows ?? []).filter((f) => f.status !== FLOW_STATUS_ACTIVE);

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Flows</h1>
        <p className="text-[13px] text-muted-foreground mt-1 mb-0">
          Agent runs across your tasks — live status, branches and merge requests.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <span>{error}</span>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : flows && flows.length === 0 ? (
        <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
          <div className="size-10 grid place-items-center rounded-lg bg-muted">
            <Inbox size={18} />
          </div>
          <div className="text-sm font-medium text-foreground">No flows yet</div>
          <div className="text-[12.5px]">
            Kick one off from a task on the{" "}
            <Link href="/" className="underline">
              Tasks
            </Link>{" "}
            page.
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          <section>
            <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
              <Workflow size={13} /> Running
              {active.length > 0 && (
                <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
                  {active.length}
                </span>
              )}
            </h2>
            <DataTable
              columns={columns}
              getActions={getActions}
              data={active}
              loading={flows == null}
              emptyMessage="Nothing running — agents show up here when a flow starts."
              onRowClick={openFlow}
            />
          </section>
          {flows != null && finished.length > 0 && (
            <section>
              <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
                <SquareCheckBig size={13} /> Finished
                <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
                  {finished.length}
                </span>
              </h2>
              <DataTable
                columns={columns}
                getActions={getActions}
                data={finished}
                className="opacity-80"
                emptyMessage="Nothing finished yet."
                onRowClick={openFlow}
              />
            </section>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
