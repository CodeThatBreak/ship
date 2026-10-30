'use client';

import { useMemo, useCallback } from 'react';
import { CircleAlertIcon, MessageCircleDashedIcon } from 'lucide-react';

import type { ModelChoice } from '@/types/model-spec';
import type { NodeUiCapabilities } from '@/types/node-capabilities';
import type { FeedEvent } from './timeline';
import type { ComposerConfig } from './composer-config';
import type { ChatTab, ChatTabs } from './types';
import { useChatComposer } from './hooks/useChatComposer';
import { useStandardComposerConfig } from './hooks/useStandardComposerConfig';
import { useChatFeed } from './hooks/useChatFeed';
import { TabStrip } from '@/components/shared';
import ChatFeed from './ChatFeed';
import ChatComposerForm from './components/chatComposerForm/ChatComposerForm';
import { ChatAction } from './types/action';
import { ta } from 'zod/v4/locales';
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

  composer,
  tabs = [],
  activeTabId,

  onAction,
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

  composer?: ComposerConfig | null;

  tabs?: ChatTab[];
  activeTabId?: string;

  onAction: (action: ChatAction) => void;
}) {
  const activeTab = useMemo(() => {
    if (!activeTabId || !tabs) return null;

    return tabs.find(t => t.id === activeTabId);
  }, [tabs, activeTabId]);

  const standard = useChatComposer({
    flowId,
    nodeKey,
    modelChoice,
  });
  const standardConfig = useStandardComposerConfig(standard, nodeLabel);

  // sending state for the feed's awaiting-reply marker: the active composer's
  // send (the plan node routes through the config seam)
  const sending = composer?.sending ?? standard.sending;

  const feed = useChatFeed({
    flowId,
    nodeKey,
    thread: activeTabId,
    events,
    nodeKeysByNodeId,
    nodeStatusByNodeId,
    sending,
    busy,
  });

  const active: ComposerConfig = composer ?? standardConfig;

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
          {tabs && activeTab ? activeTab.label : (capabilities?.panelTitle ?? `${nodeLabel} agent`)}
        </span>
      </div>

      <TabStrip
        items={tabs}
        active={activeTabId}
        onSelect={onTabChange}
        label="Conversation tabs"
        className="shrink-0 px-1 pb-2"
      />

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
        emptyTitle={activeTab?.emptyTitle}
        emptyDescription={activeTab?.emptyDescription}
      />

      {active.sendError && (
        <p role="alert" className="shrink-0 flex items-center gap-1.5 px-4 pb-1 text-[11px] text-destructive">
          <CircleAlertIcon className="size-3 shrink-0" />
          {active.sendError}
        </p>
      )}

      <ChatComposerForm config={active} modelChoice={modelChoice} onAction={onAction} />
    </div>
  );
}
