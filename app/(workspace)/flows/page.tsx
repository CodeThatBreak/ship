"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Cloud,
  FolderGit2,
  GitMerge,
  Inbox,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "cn";

type Flow = {
  id: string;
  task_id: string;
  name: string;
  status: string;
  task_key: string;
  task_summary: string;
  mr_url?: string;
  execution_mode?: string;
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
  if (/progress|review|testing/.test(s))
    return { className: "bg-info/10 text-info", label: "active" };
  if (/block|hold/.test(s))
    return { className: "bg-destructive/10 text-destructive", label: "blocked" };
  return { className: "bg-zinc-500/10 text-zinc-400", label: "todo" };
}

function StatusBadge({ status }: { status: string }) {
  const { className } = statusStyle(status);
  return <Badge className={className}>{status || "—"}</Badge>;
}

/** Worktree state for one local flow row: branch, dirty dot, ahead/behind. */
function WorktreeBadge({ status }: { status: WorktreeStatus }) {
  if (!status.registered) {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 text-warning"
        title={`Worktree unavailable: ${status.reason ?? "unknown"} (${status.path})`}
      >
        <FolderGit2 size={11} /> wt?
      </Badge>
    );
  }
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const title =
    `${status.branch ?? "(detached)"} @ ${status.path}` +
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

export default function FlowsPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeStatus>>({});

  const load = useCallback(async () => {
    const f = await fetch("/api/flows").then((r) => r.json());
    setFlows(f.flows ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Worktree status (dirty / ahead / behind) for local flows: refreshed every
  // 5s — flow events land in the DB and the rows pick the git state up here.
  const loadWorktrees = useCallback(async () => {
    const r = await fetch("/api/flows/worktree-status").then((r) => r.json()).catch(() => null);
    setWorktrees(r?.statuses ?? {});
  }, []);

  useEffect(() => {
    if (!flows.some((f) => f.execution_mode === "local")) return;
    loadWorktrees();
    const t = setInterval(loadWorktrees, 5000);
    return () => clearInterval(t);
  }, [flows, loadWorktrees]);

  const active = flows.filter((f) => f.status === "active");
  const finished = flows.filter((f) => f.status !== "active");

  const flowRow = (f: Flow) => (
    <a
      key={f.id}
      href={`/flows/${f.id}`}
      className="block rounded-xl transition-colors hover:bg-muted/40"
    >
      <div className="flex gap-3 items-center px-4 py-3 border border-border rounded-xl bg-card text-foreground hover:border-info/40 transition-colors group">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            f.status === "active"
              ? "bg-success shadow-[0_0_8px] shadow-success/60 animate-pulse"
              : "bg-zinc-600",
          )}
        />
        <span className="font-mono text-[12px] text-info shrink-0">
          {f.task_key}
        </span>
        <span className="flex-1 font-medium text-[13.5px] truncate">
          {f.task_summary}
        </span>
        {f.execution_mode === "local" ? (
          <Badge variant="outline">
            <FolderGit2 size={11} /> local
          </Badge>
        ) : (
          <Badge variant="outline">
            <Cloud size={11} /> cloud
          </Badge>
        )}
        {f.execution_mode === "local" && worktrees[f.id] && (
          <WorktreeBadge status={worktrees[f.id]} />
        )}
        {f.mr_url && (
          <Badge className="bg-violet-500/10 text-violet-400">
            <GitMerge size={11} /> MR open
          </Badge>
        )}
        <StatusBadge status={f.status} />
      </div>
    </a>
  );

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Flows</h1>
        <p className="text-[13px] text-muted-foreground mt-1 mb-0">
          Agent runs across your tasks — live status, worktrees and merge requests.
        </p>
      </header>

      {flows.length === 0 ? (
        <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
          <div className="size-10 grid place-items-center rounded-xl bg-muted">
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
              <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
                {active.length}
              </span>
            </h2>
            <div className="grid gap-2">
              {active.map(flowRow)}
              {active.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground px-1">
                  Nothing running — agents show up here when a flow starts.
                </p>
              )}
            </div>
          </section>
          {finished.length > 0 && (
            <section>
              <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px]">
                Finished
              </h2>
              <div className="grid gap-2 opacity-80">{finished.map(flowRow)}</div>
            </section>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
