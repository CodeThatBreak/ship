"use client";
import { useEffect, useMemo, useState } from "react";
import { ScanSearch, CheckCheck, User, MessageSquare, CornerDownRight, Pencil, FileCode2 } from "lucide-react";
import type { FlowData, Node } from "../app/flows/[id]/page";
import { Markdown } from "../components/markdown";
import PromptModal from "./PromptModal";
import { PanelShell } from "./NodePanel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { cn } from "../lib/utils";

type RawNote = {
  id: number;
  resolvable?: boolean;
  resolved?: boolean;
  system?: boolean;
  created_at?: string;
};

type Comment = {
  id: string; author: string; body: string; file_path?: string; line?: number;
  status: string; discussion_id?: string | null; raw?: string; created_at: string;
};

type ThreadNote = Comment & { resolvable: boolean; resolved: boolean };

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

/** Parse the stored GitLab note JSON for resolvable/resolved flags. */
function flags(c: Comment): { resolvable: boolean; resolved: boolean } {
  let resolvable = true;
  let resolved = c.status === "resolved";
  if (c.raw) {
    try {
      const n: RawNote = JSON.parse(c.raw);
      if (typeof n.resolvable === "boolean") resolvable = n.resolvable;
      if (typeof n.resolved === "boolean") resolved = n.resolved;
    } catch { /* ignore malformed raw */ }
  }
  return { resolvable, resolved };
}

/** Group flat comments into discussion threads (root = earliest note). */
function buildThreads(comments: Comment[]): Thread[] {
  const byDiscussion = new Map<string, ThreadNote[]>();
  for (const c of comments) {
    const key = c.discussion_id ?? `ind_${c.id}`;
    const note: ThreadNote = { ...c, ...flags(c) };
    const arr = byDiscussion.get(key);
    if (arr) arr.push(note);
    else byDiscussion.set(key, [note]);
  }
  const threads: Thread[] = [];
  for (const [id, notes] of byDiscussion) {
    // chronological within the thread — the first note is the root
    notes.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const root = notes[0];
    const replies = notes.slice(1);
    const open = root.status === "open";
    threads.push({
      id,
      root,
      replies,
      resolvable: root.resolvable,
      open,
      resolved: !open,
    });
  }
  // newest thread first (by root creation time)
  threads.sort((a, b) => b.root.created_at.localeCompare(a.root.created_at));
  return threads;
}

export default function ReviewView({ flow, node, action, model }:
  { flow: FlowData; node: Node; action: (a: string, b?: any) => void; fetchArtifact: (id: string) => Promise<any>; model: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!flow.mr_iid) return;
    const load = () => fetch(`/api/flows/${flow.id}/comments`).then((r) => r.json()).then((d) => setComments(d.comments ?? []));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [flow.id, flow.mr_iid]);

  const threads = useMemo(() => buildThreads(comments), [comments]);
  // Only resolvable root threads count toward "open" — system notes and plain
  // discussion comments that can't be resolved don't block the loop.
  const openThreads = threads.filter((t) => t.open && t.resolvable);
  const resolvedThreads = threads.filter((t) => !t.open && t.resolvable);

  const running = node.status === "running";

  const headerEnd = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)} disabled={running}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </>
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
        <Button variant="default" onClick={() => action("resolve", { model: model || undefined })}>
          <CheckCheck size={14} /> Resolve {openThreads.length} open comment{openThreads.length > 1 ? "s" : ""}
        </Button>
      )}
      <Button variant="default" onClick={() => action("review", { model: model || undefined })} disabled={running}>
        {running ? <><Spinner /> Reviewing…</> : <><ScanSearch size={14} /> Run AI review</>}
      </Button>
    </>
  ) : (
    <span className="text-xs text-muted-foreground">Review runs after the merge request is created.</span>
  );

  return (
    <>
      <PanelShell node={node} action={action} headerEnd={headerEnd} footer={footer}>
        {!flow.mr_iid && <p className="text-muted-foreground">Review runs after the merge request is created.</p>}

        {flow.mr_iid && comments.length === 0 && !running && (
          <div className="text-center px-5 py-16">
            <MessageSquare size={32} className="text-muted-foreground mb-3 mx-auto" />
            <p className="text-muted-foreground max-w-[380px] mx-auto">
              No MR comments yet. Run an AI review, or wait for reviewers / the webhook.
            </p>
          </div>
        )}

        {threads.length > 0 && (
          <div>
            <div className="flex gap-2 mb-3 flex-wrap">
              <Badge className="bg-amber-500/10 text-amber-400">{openThreads.length} open</Badge>
              <Badge className="bg-emerald-500/10 text-emerald-400">{resolvedThreads.length} resolved</Badge>
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
                {r.resolved && <Badge className="bg-emerald-500/10 text-emerald-400">resolved</Badge>}
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
      {note.file_path && (
        <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px] font-mono">
          <FileCode2 size={11} />
          {note.file_path}{note.line ? `:${note.line}` : ""}
        </span>
      )}
      <div className="flex-1" />
      {resolvable === false && isRoot && <Badge>note</Badge>}
      {isRoot && resolvable !== false && (
        <Badge className={note.status === "resolved" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}>{note.status}</Badge>
      )}
    </div>
  );
}
