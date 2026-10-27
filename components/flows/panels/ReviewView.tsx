"use client";
import { useMemo, useState } from "react";
import { ScanSearch, CheckCheck, User, MessageSquare, CornerDownRight, Pencil, FileCode2, CircleAlert } from "lucide-react";
import { Markdown } from "@/components/shared";
import { PromptModal } from "@/components/chat";
import { PanelShell } from "./shared";
import { registerPanel } from "./registry";
import type { PanelProps } from "./registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useFlowComments } from "@/hooks/use-flow-comments";
import { FLOW_STATUS } from "@/constants/flow";

/** One MR comment/note — mirrors hooks/use-flow-comments's MrComment. */
type Comment = {
  id: string; threadId?: string | null; author?: string | null; body: string;
  path?: string | null; line?: number | null; status: string;
  resolvable: boolean; resolved: boolean; createdAt: string;
};

type ThreadNote = Comment;

type Thread = {
  id: string;
  root: ThreadNote;
  replies: ThreadNote[];
  /** root thread participates in the resolve loop (only resolvable roots count as "open") */
  resolvable: boolean;
  /** thread-level open = root is open (and, for counting, resolvable) */
  open: boolean;
  resolved: boolean;
};

/** Group flat comments into discussion threads (root = earliest note). */
function buildThreads(comments: Comment[]): Thread[] {
  const byThread = new Map<string, ThreadNote[]>();
  for (const c of comments) {
    const key = c.threadId ?? `ind_${c.id}`;
    const arr = byThread.get(key);
    if (arr) arr.push(c);
    else byThread.set(key, [c]);
  }
  const threads: Thread[] = [];
  for (const [id, notes] of byThread) {
    // chronological within the thread — the first note is the root
    notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = notes[0];
    const replies = notes.slice(1);
    const open = root.status === "open";    threads.push({
      id,
      root,
      replies,
      resolvable: root.resolvable,
      open,
      resolved: !open,
    });
  }
  // newest thread first (by root creation time)
  threads.sort((a, b) => b.root.createdAt.localeCompare(a.root.createdAt));
  return threads;
}

export default function ReviewView({ flow, node, action, model }: PanelProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  // the query is gated on the MR existing — no MR means no fetch (and no poll)
  const commentsQuery = useFlowComments(flow.id, Boolean(flow.mr_iid));
  // stable identity so the threading memo below doesn't invalidate per render
  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);

  const threads = useMemo(() => buildThreads(comments), [comments]);
  // Only resolvable root threads count toward "open" — system notes and plain
  // discussion comments that can't be resolved don't block the loop.
  const openThreads = threads.filter((t) => t.open && t.resolvable);
  const resolvedThreads = threads.filter((t) => !t.open && t.resolvable);

  const running = node.status === FLOW_STATUS.RUNNING;
  // the comments list is mid-load or its poll failed — the empty state must
  // not render while those states are on screen instead of real data
  const commentIssue = commentsQuery.isLoading || commentsQuery.isError;

  const headerEnd = (
    <Button size="xs" variant="secondary" onClick={() => setShowPrompt(true)}>
      <Pencil size={12} /> Edit prompt
    </Button>
  );

  const footer = flow.mr_iid ? (
    <>
      <span className="text-xs text-muted-foreground">
        {openThreads.length > 0
          ? `${openThreads.length} open thread${openThreads.length > 1 ? "s" : ""} to resolve.`
          : "No open threads — the MR is clean."}
      </span>
      <div className="flex-1" />
      {openThreads.length > 0 && (
        <Button onClick={() => action("resolve", { model: model || undefined })}>
          <CheckCheck size={14} /> Resolve {openThreads.length} open comment{openThreads.length > 1 ? "s" : ""}
        </Button>
      )}
      <Button onClick={() => action("review", { model: model || undefined })} disabled={running}>
        {running ? <><Spinner /> Reviewing…</> : <><ScanSearch size={14} /> Run AI review</>}
      </Button>
    </>
  ) : (
    <span className="text-xs text-muted-foreground">Review runs after the merge request is created.</span>
  );

  return (
    <>
      <PanelShell node={node} action={action} headerEnd={headerEnd} runningLabel="Agent is reviewing the merge request…" footer={footer}>
        {!flow.mr_iid && <p className="text-muted-foreground">Review runs after the merge request is created.</p>}

        {flow.mr_iid && commentsQuery.isLoading && <ThreadListSkeleton />}

        {flow.mr_iid && commentsQuery.isError && !commentsQuery.isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-destructive" role="alert">
            <CircleAlert size={16} className="shrink-0" />
            Failed to load the MR comments.
            <Button size="xs" variant="outline" onClick={() => void commentsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {flow.mr_iid && comments.length === 0 && !commentIssue && !running && (
          <div className="text-center px-5 py-16">
            <MessageSquare size={32} className="text-muted-foreground mb-3 mx-auto" />
            <p className="text-muted-foreground max-w-[380px] mx-auto">
              No MR comments yet. Run an AI review, or wait for reviewers / the webhook.
            </p>
          </div>
        )}

        {threads.length > 0 && (
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
        )}
      </PanelShell>

      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="review"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            action("review", { prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
            setShowPrompt(false);
          }}
        />
      )}
    </>
  );
}

/** Loading skeleton mirroring the thread cards (header row + body lines). */
function ThreadListSkeleton() {
  return (
    <div className="grid gap-2.5 mt-1">
      {[0, 1].map((i) => (
        <Card key={i} className="p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="ml-auto h-3 w-10 rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-11/12 mb-1.5 rounded-full" />
          <Skeleton className="h-3.5 w-2/3 mb-1.5 rounded-full" />
          <Skeleton className="h-3.5 w-1/2 rounded-full" />
        </Card>
      ))}
    </div>
  );
}

function ThreadCard({ thread }: { thread: Thread }) {
  const { root, replies } = thread;
  return (
    <Card className={cn("p-3.5", !thread.open && thread.resolvable && "opacity-60")}>
      {/* root comment */}
      <NoteHeader note={root} isRoot resolvable={thread.resolvable} />
      <div className="text-[13px] [&_p]:my-1.5">
        <Markdown className="text-[13px]">{root.body}</Markdown>
      </div>

      {/* nested replies — hierarchy preserved, not a separate thread */}
      {replies.length > 0 && (
        <div className="mt-2.5 grid gap-2 border-l-2 border-border pl-3.5">
          {replies.map((r) => (
            <div key={r.id} className="pt-1">
              <div className="flex gap-2 items-center text-xs mb-1">
                <CornerDownRight size={12} className="text-muted-foreground shrink-0" />
                <span className="inline-flex items-center gap-[5px] font-semibold">
                  <User size={11} className="text-muted-foreground" /> {r.author}
                </span>
                {r.resolved && <Badge className="bg-success/10 text-success">resolved</Badge>}
              </div>
              <div className="text-[12.5px] [&_p]:my-1 text-muted-foreground">
                <Markdown className="text-[12.5px]">{r.body}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NoteHeader({ note, isRoot, resolvable }: { note: ThreadNote; isRoot?: boolean; resolvable?: boolean }) {
  return (
    <div className="flex gap-2 items-center text-xs mb-1.5 flex-wrap">
      <span className="inline-flex items-center gap-[5px] font-semibold">
        <User size={12} className="text-muted-foreground" /> {note.author}
      </span>
      {note.path && (
        <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px] font-mono">
          <FileCode2 size={11} />
          {note.path}{note.line ? `:${note.line}` : ""}
        </span>
      )}
      <div className="flex-1" />
      {resolvable === false && isRoot && <Badge>note</Badge>}
      {isRoot && resolvable !== false && (
        <Badge className={note.status === "resolved" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}>{note.status}</Badge>
      )}
    </div>
  );
}

// registered with the panel registry (§3.1) — served by the builtin review key
registerPanel({ type: "review" }, ReviewView);
