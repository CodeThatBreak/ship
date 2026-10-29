"use client";

import * as React from "react";
import { CircleAlertIcon, MessageCircleDashedIcon } from "lucide-react";

import type { ModelChoice } from "@/types/model-spec";
import type { NodeUiCapabilities } from "@/types/node-capabilities";
import type { FeedEvent } from "./timeline";
import type { ComposerConfig } from "./composer-config";
import type { ChatTabs } from "./types";
import { useChatComposer } from "./hooks/use-chat-composer";
import { useChatFeed } from "./hooks/use-chat-feed";
import { TabStrip } from "@/components/shared";
import ChatFeed from "./ChatFeed";
import ChatComposerForm from "./ChatComposerForm";

/**
 * The flow's chat rail: heading, transcript feed and the composer.
 * Generic by contract (AGENTS §2.4): a feature drives the composer through
 * the `composer` config seam (docs/plan-conversation-refine.md §4d) —
 * without it the standard draft/send mechanics apply, unchanged. The
 * `tabs` seam (its sibling) splits the feed into the feature's conversation
 * tabs — the plan node's main plan + per-sub-plan-refinement threads —
 * rendered as the generic shared TabStrip.
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
  setModelChoice,
  composer,
  tabs,
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
  setModelChoice: (choice: ModelChoice | null) => void;
  /** the config-driven composer (the plan node, §4d); absent = the standard composer */
  composer?: ComposerConfig | null;
  /** the feed's thread tabs (the plan node's per-refinement chats); absent = one transcript */
  tabs?: ChatTabs | null;
}) {
  // the active tab (for the heading's context label + the tab's empty state)
  const activeTab = tabs?.items.find((t) => t.id === tabs.active) ?? null;

  const standard = useChatComposer({
    flowId,
    nodeKey,
    modelChoice,
  });

  // sending state for the feed's awaiting-reply marker: the active composer's
  // send (the plan node routes through the config seam)
  const sending = composer?.sending ?? standard.sending;

  const feed = useChatFeed({
    flowId,
    nodeKey,
    thread: tabs?.active ?? null,
    events,
    nodeKeysByNodeId,
    nodeStatusByNodeId,
    sending,
    busy,
  });

  // The composer that renders: feature-built config when provided, else the
  // standard chat mechanics wrapped in the same zero-cost config shape.
  const active: ComposerConfig = composer ?? {
    draft: standard.draft,
    onDraftChange: standard.setDraft,
    loading: false,
    error: null,
    sending: standard.sending,
    sendError: standard.sendError,
    sendLabel: "Send",
    growing: false,
    onSend: (draft) => standard.send(draft),
    placeholder: `Message the ${nodeLabel} agent…`,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel heading — a configured panel title replaces the generic agent label */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-2.5">
        <MessageCircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[13.5px] font-semibold leading-none">Chat</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          {tabs && activeTab ? activeTab.label : capabilities?.panelTitle ?? `${nodeLabel} agent`}
        </span>
      </div>

      {tabs && (
        <TabStrip
          items={tabs.items}
          active={tabs.active}
          onSelect={tabs.onActive}
          label="Conversation tabs"
          className="shrink-0 px-1 pb-2"
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
        emptyTitle={
          activeTab ? `Refine the “${activeTab.label}” sub-plan` : undefined
        }
        emptyDescription={
          activeTab
            ? "This sub-plan's refinement conversation — refine it further or ask about its steps."
            : undefined
        }
      />

      {active.sendError && (
        <p
          role="alert"
          className="shrink-0 flex items-center gap-1.5 px-4 pb-1 text-[11px] text-destructive"
        >
          <CircleAlertIcon className="size-3 shrink-0" />
          {active.sendError}
        </p>
      )}

      <ChatComposerForm
        config={active}
        modelChoice={modelChoice}
        onChangeModelChoice={setModelChoice}
      />
    </div>
  );
}
