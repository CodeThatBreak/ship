'use client';

import { useMemo, useCallback, type ReactNode } from 'react';
import { CircleAlertIcon, MessageCircleDashedIcon } from 'lucide-react';

import type { ModelChoice } from '@/types/model-spec';
import type { NodeUiCapabilities } from '@/types/node-capabilities';
import type { FeedEvent } from './timeline';
import type { ChatTab } from './types';
import { useChatComposer, type SendMutationFn } from './hooks/useChatComposer';
import { useChatFeed } from './hooks/useChatFeed';
import { TabStrip } from '@/components/shared';
import ChatFeed from './ChatFeed';
import ChatComposerForm from './components/chatComposerForm/ChatComposerForm';
import { ChatAction } from './types/action';
import { ACTION_TYPES } from './constants/action';

/**
 * The flow's chat rail: heading, transcript feed and the composer.
 * Generic by contract (AGENTS §2.4): a feature drives the composer through
 * the `composer` config seam (docs/plan-conversation-refine.md §4d) —
 * without it the standard draft/send mechanics apply, unchanged. The
 * `tabs` seam (its sibling) splits the feed into the feature's conversation
 * threads — each tab carrying its own empty-state copy — rendered as the
 * generic shared TabStrip.
 */
export default function ChatPanel({
  flowId,
  nodeKey,
  nodeLabel,
  capabilities,
  busy,
  events,
  nodeKeysByNodeId,
  nodeStatusByNodeId,
  modelChoice,

  threads = [],
  activeThreadId,

  onAction,

  initialDraft,
  loading = false,
  caption,
  placeholder,
  sendLabel = 'Send',
  sendError,
  canReset = false,
  canSend = false,

  aside,
  error,

  sendMutationFn,
}: {
  flowId: string;
  nodeKey: string;
  /** the node's display name (label / template name) — for the agent-facing copy */
  nodeLabel: string;
  /** the node contract's UI capabilities (chat/panel title, §3.2) */
  capabilities?: NodeUiCapabilities | null;
  busy: boolean;
  events: FeedEvent[];
  nodeKeysByNodeId?: Map<string, string>;
  /** node id → status; used as the authority on whether a run is really running,
   *  since a run's "finished" event can fall outside the fetched event window */
  nodeStatusByNodeId?: Map<string, string>;
  modelChoice: ModelChoice | null;

  threads?: ChatTab[];
  activeThreadId?: string;

  onAction: (action: ChatAction) => void;

  initialDraft?: string;
  loading?: boolean;
  caption?: ReactNode;
  placeholder?: string;
  sendLabel?: string;
  sendError?: ReactNode;
  canReset?: boolean;
  canSend?: boolean;

  aside?: ReactNode;
  error?: ReactNode;

  sendMutationFn?: SendMutationFn;
}) {
  const activeThread = useMemo(() => {
    if (!activeThreadId || !threads) return null;

    return threads.find(t => t.id === activeThreadId);
  }, [threads, activeThreadId]);

  const { isPending: isSendingMessage } = useChatComposer({
    flowId,
    nodeKey,
    modelChoice,
    thread: activeThreadId,
    sendMutationFn,
  });

  const {
    rows,
    awaitingReply,
    messagesQuery: { isLoading: messagesLoading, error: messagesError, refetch: refetchMessage },
  } = useChatFeed({
    flowId,
    nodeKey,
    thread: activeThreadId,
    events,
    nodeKeysByNodeId,
    nodeStatusByNodeId,
    sending: isSendingMessage,
    busy,
  });

  const onTabChange = useCallback(
    (id: string) => {
      onAction({
        type: ACTION_TYPES.TAB_CHANGED,
        payload: { tabId: id },
      });
    },
    [onAction]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel heading — a configured panel title replaces the generic agent label */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-2.5">
        <MessageCircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[13.5px] font-semibold leading-none">Chat</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          {threads && activeThread ? activeThread.label : (capabilities?.panelTitle ?? `${nodeLabel} agent`)}
        </span>
      </div>

      <TabStrip
        items={threads}
        active={activeThreadId}
        onSelect={onTabChange}
        label="Conversation tabs"
        className="shrink-0 px-1 pb-2"
      />

      <ChatFeed
        rows={rows}
        loading={messagesLoading}
        errorText={messagesError?.message}
        onRetry={refetchMessage}
        awaitingReply={awaitingReply}
        nodeLabel={nodeLabel}
        emptyTitle={activeThread?.emptyTitle}
        emptyDescription={activeThread?.emptyDescription}
      />

      {sendError && (
        <p role="alert" className="shrink-0 flex items-center gap-1.5 px-4 pb-1 text-[11px] text-destructive">
          <CircleAlertIcon className="size-3 shrink-0" />
          {sendError}
        </p>
      )}

      <ChatComposerForm
        aside={aside}
        error={error}
        caption={caption}
        loading={loading}
        canSend={canSend}
        canReset={canReset}
        draft={initialDraft}
        sendLabel={sendLabel}
        modelChoice={modelChoice}
        placeholder={placeholder}
        onAction={onAction}
      />
    </div>
  );
}
