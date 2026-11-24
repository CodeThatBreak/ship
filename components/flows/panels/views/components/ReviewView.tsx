"use client";

import { useMemo, useState } from "react";
import { ScanSearch, CheckCheck, MessageSquare, CircleAlert, Gauge } from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { PanelShell } from "../../components/shell/PanelShell";
import { useNodePanel } from "../../context";
import { useFlowComments } from "../../../hooks/useFlowComments";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import { buildThreads } from "../../review/utils/buildThreads";
import { ThreadList } from "../../review/components/ThreadList";
import { ThreadListSkeleton } from "../../review/components/ThreadListSkeleton";
import { REVIEW_TAB, type ReviewTab } from "../constants/tabs";
import { PanelTabs } from "./tabs/PanelTabs";
import { UsageArtifact } from "./tabs/UsageArtifact";

const REVIEW_TABS = [
  { value: REVIEW_TAB.COMMENTS, label: "Comments", icon: MessageSquare },
  { value: REVIEW_TAB.USAGE, label: "Usage", icon: Gauge },
] as const;

export default function ReviewView() {
  const { flow, node, action, model } = useNodePanel();
  const [activeTab, setActiveTab] = useState<ReviewTab>(REVIEW_TAB.COMMENTS);

  const commentsQuery = useFlowComments(flow.id, Boolean(flow.mrIid));
  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);

  const threads = useMemo(() => buildThreads(comments), [comments]);
  const openThreads = threads.filter((t) => t.open && t.resolvable);

  const running = node.status === FLOW_STATUS.RUNNING;
  const commentIssue = commentsQuery.isLoading || commentsQuery.isError;

  const footer = flow.mrIid ? (
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
    <PanelShell
      node={node}
      hideCost
      fullBleedContent
      runningLabel="Agent is reviewing the merge request…"
      footer={footer}
    >
      <PanelTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Review views"
        tabs={REVIEW_TABS}
      >
        <TabsContent value={REVIEW_TAB.COMMENTS} className="px-5 pt-4 pb-4">
          {!flow.mrIid && <p className="text-muted-foreground">Review runs after the merge request is created.</p>}

          {flow.mrIid && commentsQuery.isLoading && <ThreadListSkeleton />}

          {flow.mrIid && commentsQuery.isError && !commentsQuery.isLoading && (
            <div className="flex items-center gap-2 text-[13px] text-destructive" role="alert">
              <CircleAlert size={16} className="shrink-0" />
              Failed to load the MR comments.
              <Button size="xs" variant="outline" onClick={() => void commentsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {flow.mrIid && comments.length === 0 && !commentIssue && !running && (
            <EmptyHint icon={MessageSquare}>
              No MR comments yet. Run an AI review, or wait for reviewers / the webhook.
            </EmptyHint>
          )}

          {threads.length > 0 && <ThreadList threads={threads} />}
        </TabsContent>
        <TabsContent value={REVIEW_TAB.USAGE} className="px-5 pt-4 pb-4">
          <UsageArtifact node={node} />
        </TabsContent>
      </PanelTabs>
    </PanelShell>
  );
}
