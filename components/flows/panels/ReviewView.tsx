"use client";
import { useMemo, useState } from "react";
import { ScanSearch, CheckCheck, MessageSquare, Pencil, CircleAlert } from "lucide-react";
import { PromptModal } from "@/components/chat";
import { PanelShell } from "./shared";
import { useNodePanel } from "./context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyHint } from "@/components/shared";
import { useFlowComments } from "../hooks/useFlowComments";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import { buildThreads } from "./review/buildThreads";
import { ThreadCard } from "./review/ThreadCard";
import { ThreadListSkeleton } from "./review/ThreadListSkeleton";

export default function ReviewView() {
  const { flow, node, action, model } = useNodePanel();
  const [showPrompt, setShowPrompt] = useState(false);

  const commentsQuery = useFlowComments(flow.id, Boolean(flow.mr_iid));
  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);

  const threads = useMemo(() => buildThreads(comments), [comments]);
  const openThreads = threads.filter((t) => t.open && t.resolvable);
  const resolvedThreads = threads.filter((t) => !t.open && t.resolvable);

  const running = node.status === FLOW_STATUS.RUNNING;
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
        <Button onClick={() => action(FLOW_ACTION.RESOLVE, { model: model || undefined })}>
          <CheckCheck size={14} /> Resolve {openThreads.length} open comment{openThreads.length > 1 ? "s" : ""}
        </Button>
      )}
      <Button onClick={() => action(FLOW_ACTION.REVIEW, { model: model || undefined })} disabled={running}>
        {running ? <><Spinner /> Reviewing…</> : <><ScanSearch size={14} /> Run AI review</>}
      </Button>
    </>
  ) : (
    <span className="text-xs text-muted-foreground">Review runs after the merge request is created.</span>
  );

  return (
    <>
      <PanelShell node={node} headerEnd={headerEnd} runningLabel="Agent is reviewing the merge request…" footer={footer}>
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
          <EmptyHint icon={MessageSquare}>
            No MR comments yet. Run an AI review, or wait for reviewers / the webhook.
          </EmptyHint>
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
            action(FLOW_ACTION.REVIEW, { prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
            setShowPrompt(false);
          }}
        />
      )}
    </>
  );
}
