'use client';

import { useMemo, useCallback, type ReactNode, type RefObject } from 'react';
import { CircleAlertIcon, MessageCircleDashedIcon } from 'lucide-react';

import type { ModelChoice } from '@/types/model-spec';
import type { NodeUiCapabilities } from '@/types/node-capabilities';
import type { FeedEvent } from './timeline';
import type { ChatTab, ChatInputHandle } from './types';
import { errorMessageOf } from '@/hooks/fetch-json';
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

  threads,
  activeThreadId,

  onAction,
  setModelChoice,

  chatInputRef,

  initialDraft,
  loading = false,
  caption,
  placeholder,
  sendLabel = 'Send',
  canReset = false,
  canSend,

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

  /**
   * The feature-owned action seam (e.g. the plan's thread switch): the
   * THREAD_CHANGED actions flow up; the rail owns the model pick below.
   */
  onAction?: (action: ChatAction) => void;
  /** the rail-owned model pick (SET_MODEL resolves here) */
  setModelChoice?: (choice: ModelChoice | null) => void;

  /** the composer input's imperative handle (the plan's thread draft swaps) */
  chatInputRef?: RefObject<ChatInputHandle | null>;

  initialDraft?: string;
  loading?: boolean;
  caption?: ReactNode;
  placeholder?: string;
  sendLabel?: string;
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

  // the feed's thread filter (`messages.thread`): the marked-main tab is the
  // unthreaded main conversation — that's ChatTab's contract ("absent (null)
  // = single-transcript behavior", the run/event trail included); every other
  // tab's id IS the thread key that isolates its refinement conversation. An
  // active id with NO matching tab (the branch-less plan rail renders no tab
  // strip at all) must fall back to the main conversation — filtering under a
  // phantom thread id would hide both the messages and the run/event trail.
  const feedThread = activeThread ? ((activeThread.main ? null : activeThreadId) ?? null) : null;

  const {
    sendMessageMutation,
    isPending: isSendingMessage,
    error: sendMutationError,
    resetSendError,
  } = useChatComposer({
    flowId,
    nodeKey,
    modelChoice,
    thread: feedThread,
    sendMutationFn,
  });
  const {
    rows,
    awaitingReply,
    messagesQuery: { isLoading: messagesLoading, error: messagesError, refetch: refetchMessage },
  } = useChatFeed({
    flowId,
    nodeKey,
    thread: feedThread,
    events,
    nodeKeysByNodeId,
    nodeStatusByNodeId,
    sending: isSendingMessage,
    busy,
  });

  // the rail-owned action routing (AGENTS §2.4: no feature forks inside the
  // composer): SET_MODEL is the generic rail's model pick; feature-owned
  // actions (the plan's THREAD_CHANGED) flow to the panel's `onAction` seam
  const handleAction = useCallback(
    (action: ChatAction) => {
      if (action.type === ACTION_TYPES.SET_MODEL) {
        setModelChoice?.(action.payload.model);
        return;
      }
      if (action.type === ACTION_TYPES.DRAFT_CHANGED) {
        resetSendError();
      }
      onAction?.(action);
    },
    [onAction, setModelChoice, resetSendError]
  );

  const onThreadChange = useCallback(
    (threadId: string) => {
      handleAction({ type: ACTION_TYPES.THREAD_CHANGED, payload: { threadId } });
    },
    [handleAction]
  );

  // the composer's send target: the feature's `sendMutationFn` when given
  // (it receives the draft text with the current model pick and thread),
  // else the rail's standard chat send
  const onSend = useCallback((draft: string) => sendMessageMutation(draft), [sendMessageMutation]);

  const sendFailureMessage = errorMessageOf(sendMutationError);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel heading — a configured panel title replaces the generic agent label */}
      <div className="shrink-0 flex items-center gap-2 pl-1 pr-4.5 pb-2.5">
        <MessageCircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[13.5px] font-semibold leading-none">Chat</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          {threads && activeThread ? activeThread.label : (capabilities?.panelTitle ?? `${nodeLabel} agent`)}
        </span>
      </div>

      <TabStrip
        items={threads ?? []}
        active={activeThreadId}
        onSelect={onThreadChange}
        label="Conversation tabs"
        className="shrink-0 pl-1 pr-4.5 pb-2"
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

      {sendFailureMessage && (
        <p role="alert" className="shrink-0 flex items-center gap-1.5 pl-4 pr-4 pb-1 text-[11px] text-destructive">
          <CircleAlertIcon className="size-3 shrink-0" />
          {sendFailureMessage}
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
        onSend={onSend}
        onAction={handleAction}
        chatInputRef={chatInputRef}
      />
    </div>
  );
}
