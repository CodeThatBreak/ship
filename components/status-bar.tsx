"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cloud, FolderGit2, GitMerge, Loader2, Bot } from "lucide-react";
import { cn } from "cn";

type AgentStatus = {
  flowId: string;
  taskKey: string;
  summary: string;
  node: string | null;
  mode: string;
  status: string;
  mrOpen: boolean;
};

type StatusPayload = {
  agents: AgentStatus[];
  agentsRunning: number;
  runsRunning: number;
  openMrs: { flowId: string; taskKey: string; mrUrl: string; mrIid: number | null }[];
  openMrCount: number;
  repoCount: number;
};

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
  const [status, setStatus] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const data = await fetch("/api/status")
        .then((r) => r.json())
        .catch(() => null);
      if (alive) setStatus(data);
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const agents = status?.agents ?? [];
  const running = status?.agentsRunning ?? 0;
  const mrs = status?.openMrCount ?? 0;
  const busy = running > 0;

  return (
    <footer
      className="sticky bottom-0 z-40 flex h-7 items-center gap-3 border-t border-border bg-background/85 px-3 text-[11px] text-muted-foreground backdrop-blur select-none"
    >
      {/* ── left: agent activity ─────────────────────────────────────────── */}
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

      {/* ── right: MRs + repos ───────────────────────────────────────────── */}
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
    </footer>
  );
}
