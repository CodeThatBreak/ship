"use client";

import * as React from "react";
import { CircleAlertIcon, MessageCircleDashedIcon } from "lucide-react";

import PromptModal from "./prompt-modal/PromptModal";
import type { ModelChoice } from "@/types/model-spec";
import type { NodeCapabilities } from "@/types/node-capabilities";
import type { FeedEvent } from "./timeline";
import { useNodePrompt } from "@/hooks/use-flow-chat";
import { useChatComposer } from "./hooks/use-chat-composer";
import { useChatFeed } from "./hooks/use-chat-feed";
import NodePromptBox from "./NodePromptBox";
import ChatFeed from "./ChatFeed";
import ChatComposerForm from "./ChatComposerForm";
import type { PlanOptions, PlanStartOpts } from "./types";

// Re-exported for backwards compatibility: these previously lived on
// ChatPanel itself; they are now defined in ./chat/types.
export type { PlanOptions, PlanStartOpts };

export default function ChatPanel({
  flowId,
  nodeKey,
  nodeLabel,
  capabilities,
  busy,
  canRefine = true,
  events,
  nodeKeysByNodeId,
  nodeStatusByNodeId,
  modelChoice,
  setModelChoice,
  showPromptBox = false,
  planOptions,
  setPlanOptions,
  onStartNode,
}: {
  flowId: string;
  nodeKey: string;
  /** the node's display name (label / template name) — for the agent-facing copy */
  nodeLabel: string;
  /** the node contract's UI capabilities (refine/chat/prompt, §3.2) */
  capabilities?: NodeCapabilities | null;
  busy: boolean;
  canRefine?: boolean;
  events: FeedEvent[];
  nodeKeysByNodeId?: Map<string, string>;
  /** node id → status; used as the authority on whether a run is really running,
   *  since a run's "finished" event can fall outside the fetched event window */
  nodeStatusByNodeId?: Map<string, string>;
  modelChoice: ModelChoice | null;
  setModelChoice: (choice: ModelChoice | null) => void;
  /** plan-style nodes, before any output exists: show the prompt preview box over the chat */
  showPromptBox?: boolean;
  planOptions?: PlanOptions;
  setPlanOptions?: (opts: PlanOptions) => void;
  /** start the node's first run (the prompt box's Generate / the prompt modal's Run) */
  onStartNode?: (opts?: PlanStartOpts) => void | Promise<void>;
}) {
  const composer = useChatComposer({
    flowId,
    nodeKey,
    capabilities,
    canRefine,
    modelChoice,
    showPromptBox,
  });

  const feed = useChatFeed({
    flowId,
    nodeKey,
    events,
    nodeKeysByNodeId,
    nodeStatusByNodeId,
    sending: composer.sending,
    busy,
  });

  // prompt preview over the chat (prompt-publishing nodes, before a first
  // output exists): the node's prompt is fetched so the box shows a partial
  // preview — click to expand, edit icon moves it into the prompt modal
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [promptEditing, setPromptEditing] = React.useState(false);
  const promptQuery = useNodePrompt(flowId, capabilities?.promptNode ?? nodeKey, {
    enabled: showPromptBox,
  });
  // null = still loading; "" (or the fetched body) = rendered in the box
  const nodePrompt = promptQuery.data ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel heading */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-2.5">
        <MessageCircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[13.5px] font-semibold leading-none">Chat</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          {nodeLabel} agent
        </span>
      </div>

      {showPromptBox && (
        <NodePromptBox
          prompt={nodePrompt}
          error={promptQuery.isError}
          onRetry={() => void promptQuery.refetch()}
          open={promptOpen}
          onToggle={() => setPromptOpen((v) => !v)}
          onEdit={() => setPromptEditing(true)}
          onGenerate={() => {
            setPromptOpen(false);
            void onStartNode?.();
          }}
          generating={busy}
          generateLabel={`Generate ${nodeLabel.toLowerCase()}`}
        />
      )}

      <ChatFeed
        loading={feed.messagesQuery.isLoading}
        errorText={
          feed.messagesQuery.isError
            ? feed.messagesQuery.error instanceof Error
              ? feed.messagesQuery.error.message
              : null
            : null
        }
        onRetry={() => void feed.messagesQuery.refetch()}
        rows={feed.rows}
        awaitingReply={feed.awaitingReply}
        nodeLabel={nodeLabel}
      />

      {composer.sendError && (
        <p
          role="alert"
          className="shrink-0 flex items-center gap-1.5 px-4 pb-1 text-[11px] text-destructive"
        >
          <CircleAlertIcon className="size-3 shrink-0" />
          {composer.sendError.message}
        </p>
      )}

      <ChatComposerForm
        formRef={composer.formRef}
        draft={composer.draft}
        onChangeDraft={composer.setDraft}
        onSend={(draft) => void composer.send(draft)}
        canSend={composer.canSend}
        sending={composer.sending}
        inputLocked={composer.inputLocked}
        nodeLabel={nodeLabel}
        capabilities={capabilities}
        refineAvailable={composer.refineAvailable}
        refineOn={composer.refineOn}
        onToggleRefine={composer.toggleRefine}
        modelChoice={modelChoice}
        onChangeModelChoice={setModelChoice}
        // the plan toggles belong to the "before the first run" prompt box
        // state — without it they were hidden (the original gating)
        planOptions={showPromptBox ? planOptions : undefined}
        onChangePlanOptions={setPlanOptions}
      />

      {promptEditing && (
        <PromptModal
          flowId={flowId}
          nodeKey={capabilities?.promptNode ?? nodeKey}
          open={promptEditing}
          onClose={() => setPromptEditing(false)}
          onRun={(prompt, promptIsBody) => {
            setPromptEditing(false);
            void onStartNode?.({ prompt, promptIsBody });
          }}
        />
      )}
    </div>
  );
}
