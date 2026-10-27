"use client";
import {
  BookOpen,
  Bug,
  CircleDashed,
  CornerDownRight,
  ExternalLink,
  Layers,
  SquareCheckBig,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LiveTask } from "@/types/tasks";

type TypeStyle = { className: string; Icon: typeof Bug };

/** Issue-type icon + chip tint (sub-task / bug / story / epic / task). */
function typeStyle(issueType: string): TypeStyle {
  const t = (issueType ?? "").toLowerCase();
  if (t.includes("sub-task") || t.includes("subtask"))
    return { Icon: CornerDownRight, className: "bg-zinc-500/10 text-zinc-400" };
  if (t.includes("bug"))
    return { Icon: Bug, className: "bg-destructive/10 text-destructive" };
  if (t.includes("story"))
    return { Icon: BookOpen, className: "bg-violet-500/10 text-violet-400" };
  if (t.includes("epic"))
    return { Icon: Layers, className: "bg-fuchsia-500/10 text-fuchsia-400" };
  if (t.includes("task"))
    return { Icon: SquareCheckBig, className: "bg-info/10 text-info" };
  return { Icon: CircleDashed, className: "bg-zinc-500/10 text-zinc-400" };
}

/** The key chip in the Task column: deep link to the provider, type-tinted. */
export function TypeChip({ task }: { task: LiveTask }) {
  const { Icon, className } = typeStyle(task.issueType);
  return (
    <a
      href={task.externalUrl}
      target="_blank"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:brightness-125",
        className,
      )}
      title={task.issueType || "issue"}
    >
      <Icon size={12} />
      <span className="font-mono">{task.key}</span>
      <ExternalLink size={9} className="opacity-50" />
    </a>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  const className = /done|closed|resolved|complete/.test(s)
    ? "bg-success/10 text-success"
    : /progress|review|testing/.test(s)
      ? "bg-info/10 text-info"
      : /block|hold/.test(s)
        ? "bg-destructive/10 text-destructive"
        : "bg-zinc-500/10 text-zinc-400";
  return <Badge className={className}>{status || "—"}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const p = (priority ?? "").toLowerCase();
  const cls = /highest|high|critical|urgent/.test(p)
    ? "bg-destructive/10 text-destructive"
    : /medium|moderate/.test(p)
      ? "bg-warning/10 text-warning"
      : "bg-zinc-500/10 text-zinc-400";
  return (
    <Badge variant="outline" className={cn("text-[11px] border-transparent", cls)}>
      {priority || "—"}
    </Badge>
  );
}
