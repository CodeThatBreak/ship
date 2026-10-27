"use client";
import { FolderGit2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WorktreeStatus } from "@/types/flows";
import { FLOW_STATUS } from "@/constants/flow";

/** Status bucket style: success when terminal, info while running, blocked. */
export function statusStyle(status: string): { className: string; label: string } {
  const s = (status ?? "").toLowerCase();
  if (/done|closed|resolved|complete/.test(s))
    return { className: "bg-success/10 text-success", label: "done" };
  if (/active|progress|review|testing/.test(s))
    return { className: "bg-info/10 text-info", label: "active" };
  if (/block|hold/.test(s))
    return { className: "bg-destructive/10 text-destructive", label: "blocked" };
  return { className: "bg-zinc-500/10 text-zinc-400", label: "todo" };
}

export function StatusBadge({ status }: { status: string }) {
  const { className, label } = statusStyle(status);
  return <Badge className={className}>{status ? label : "—"}</Badge>;
}

/** Worktree state for one local flow row: branch, dirty dot, ahead/behind. */
export function WorktreeBadge({ status }: { status: WorktreeStatus }) {
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
export const EMPTY_CELL = (
  <span className="text-muted-foreground/50">—</span>
);

/** The running dot in the Flow column (active flows pulse). */
export function FlowStatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === FLOW_STATUS.ACTIVE
          ? "bg-success shadow-[0_0_8px] shadow-success/60 animate-pulse"
          : "bg-zinc-600",
      )}
    />
  );
}
