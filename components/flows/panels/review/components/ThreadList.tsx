"use client";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ReviewThread } from "../utils/buildThreads";
import { ThreadCard } from "./ThreadCard";

/**
 * The MR discussion threads, shared: the built-in review panel renders the
 * live MR threads through it, and the `review` artifact renderer (task 19)
 * renders the threads a review run published through the same list — one
 * thread markup source, so the two can never drift (the PlainArtifact
 * precedent). Presentational: threads in, JSX out.
 */
export const ThreadList = ({ threads }: { threads: ReviewThread[] }) => {
  const openThreads = threads.filter((t) => t.open && t.resolvable);
  const resolvedThreads = threads.filter((t) => !t.open && t.resolvable);
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <MessageSquare size={14} /> Discussion threads
      </h3>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Badge className="bg-warning/10 text-warning">{openThreads.length} open</Badge>
        <Badge className="bg-success/10 text-success">{resolvedThreads.length} resolved</Badge>
        {threads.length !== openThreads.length + resolvedThreads.length && (
          <Badge>{threads.length - openThreads.length - resolvedThreads.length} note{threads.length - openThreads.length - resolvedThreads.length > 1 ? "s" : ""}</Badge>
        )}
      </div>
      <div className="grid gap-2.5">
        {threads.map((t) => (
          <ThreadCard key={t.id} thread={t} />
        ))}
      </div>
    </div>
  );
};