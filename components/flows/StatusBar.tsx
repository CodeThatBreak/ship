"use client";

import Link from "next/link";
import { Cloud, FolderGit2, GitMerge, Loader2, Bot, CircleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentStatus } from "./hooks/useAgentStatus";
import { cn } from "@/lib/utils";

const NODE_LABELS: Record<string, string> = {
  plan: "planning",
  build: "building",
  pipeline: "pipeline",
  review: "reviewing",
  resolve: "resolving",
};

/**
 * IDE-style status bar pinned to the bottom of the workspace shell.
 *
 * Left: what the agents are doing right now (active flows, per node).
 * Right: open MRs, repo count. Polls /api/status every 5s.
 */
export function StatusBar() {
  const { data: status, isLoading, isError, refetch } = useAgentStatus();

  const agents = status?.agents ?? [];
  const running = status?.agentsRunning ?? 0;
  const mrs = status?.openMrCount ?? 0;
  const busy = running > 0;

  return (
    <footer
      className="sticky bottom-0 z-40 flex h-7 items-center gap-3 border-t border-border bg-background/85 px-3 text-[11px] text-muted-foreground backdrop-blur select-none"
    >
      {isLoading ? (
        <StatusBarSkeleton />
      ) : isError ? (
        <StatusBarError onRetry={() => void refetch()} />
      ) : (
        <>
          {/* ── left: agent activity ───────────────────────────────────────── */}
          <span className="inline-flex items-center gap-1.5 min-w-0">
            {busy ? (
              <Loader2 size={12} className="animate-spin text-success" />
            ) : (
              <Bot size={12} className="opacity-60" />
            )}
            <span className={cn(busy && "text-success font-medium")}>
              {running === 0 ? (
                "No agents running"
              ) : (
                <Link href="/flows" className="hover:text-foreground transition-colors">
                  {running} agent{running !== 1 ? "s" : ""} running
                </Link>
              )}
            </span>
            {agents.slice(0, 2).map((a) => (
              <Link
                key={a.flowId}
                href={`/flows/${a.flowId}`}
                className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-muted px-1.5 py-0.5 hover:text-foreground transition-colors max-w-[220px]"
                title={`${a.taskKey} — ${a.summary}\n${NODE_LABELS[a.node ?? ""] ?? a.node ?? ""}`}
              >
                <span className="font-mono text-[10px] text-info">{a.taskKey}</span>
                {a.node && (
                  <span className="truncate">
                    {NODE_LABELS[a.node] ?? a.node}
                  </span>
                )}
                {a.mode === "local" ? (
                  <FolderGit2 size={9} className="opacity-60 shrink-0" />
                ) : (
                  <Cloud size={9} className="opacity-60 shrink-0" />
                )}
              </Link>
            ))}
            {agents.length > 2 && (
              <span className="hidden sm:inline">+{agents.length - 2} more</span>
            )}
          </span>

          <span className="flex-1" />

          {/* ── right: MRs + repos ─────────────────────────────────────────── */}
          {mrs > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <GitMerge size={11} className="text-violet-400" />
              <span>
                {mrs} MR{mrs !== 1 ? "s" : ""} open
              </span>
              {status?.openMrs.slice(0, 2).map((mr) => (
                <Link
                  key={mr.flowId}
                  href={`/flows/${mr.flowId}`}
                  className="font-mono text-[10px] hover:text-foreground transition-colors"
                >
                  {mr.taskKey}
                </Link>
              ))}
            </span>
          )}
          <span
            className="hidden md:inline-flex items-center gap-1.5"
            title="Registered repositories"
          >
            <FolderGit2 size={11} />
            {status?.repoCount ?? 0} repos
          </span>
        </>
      )}
    </footer>
  );
}

/** Loading skeleton mirroring the bar's layout: activity pill left, count right. */
function StatusBarSkeleton() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <Skeleton className="h-3.5 w-44 rounded-full" />
      </span>
      <span className="flex-1" />
      <Skeleton className="h-3.5 w-16 rounded-full" />
    </>
  );
}

/** Error state: the snapshot is unavailable — inline note with a retry action. */
function StatusBarError({ onRetry }: { onRetry: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" role="alert">
      <CircleAlert size={12} className="text-destructive shrink-0" />
      <span className="truncate">Status unavailable</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 underline underline-offset-2 transition-colors hover:text-foreground"
      >
        retry
      </button>
    </span>
  );
}
