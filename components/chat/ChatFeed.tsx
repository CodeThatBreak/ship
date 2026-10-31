'use client';

import { MessageCircleDashedIcon } from 'lucide-react';

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import ChatFeedSkeleton from './ChatFeedSkeleton';
import ChatFeedError from './ChatFeedError';
import PendingRow from './PendingRow';
import ChatMessageRow from './ChatMessageRow';
import RunSectionRow from './RunSectionRow';
import FlowEventRow from './FlowEventRow';
import type { TimelineRow } from './timeline';
import { timelineRowKey } from './timeline-keys';

/** The unified timeline (chat messages interleaved with run sections and
 *  flow-level events) inside the message scroller, with the transcript's
 *  loading, error and empty states (§2.8). */
export default function ChatFeed({
  loading,
  errorText,
  onRetry,
  rows,
  awaitingReply,
  nodeLabel,
  emptyTitle,
  emptyDescription,
}: {
  /** the transcript's first fetch (background refetches keep the current rows) */
  loading: boolean;
  /** transcript load error message — null when the fetch succeeded */
  errorText?: string;
  onRetry: () => void;
  rows: TimelineRow[];
  awaitingReply: boolean;
  nodeLabel: string;
  /** empty-state copy overrides (the refinement tabs thread theirs) */
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const itemCount = rows.length + (awaitingReply ? 1 : 0);

  return (
    <MessageScrollerProvider autoScroll>
      {loading ? (
        <ChatFeedSkeleton />
      ) : errorText ? (
        <ChatFeedError message={errorText} onRetry={onRetry} />
      ) : itemCount === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleDashedIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle ?? `Message the ${nodeLabel} agent`}</EmptyTitle>
            <EmptyDescription>
              {emptyDescription ?? 'Ask for changes, refinements, or explain what to do differently.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScroller className="min-h-0">
          <MessageScrollerViewport className="scroll-fade-b">
            <MessageScrollerContent aria-busy={awaitingReply} className="gap-4 pl-4 pr-7.5 py-4 text-sm">
              {rows.map((row) => {
                const key = timelineRowKey(row);
                return (
                  <MessageScrollerItem
                    key={key}
                    messageId={key}
                    scrollAnchor={row.kind === 'msg' && row.msg.role === 'user'}
                  >
                    {row.kind === 'msg' ? <ChatMessageRow msg={row.msg} /> : null}
                    {row.kind === 'run' ? <RunSectionRow section={row.section} /> : null}
                    {row.kind === 'event' ? <FlowEventRow ev={row.ev} /> : null}
                  </MessageScrollerItem>
                );
              })}
              {awaitingReply && (
                <MessageScrollerItem messageId="pending" scrollAnchor>
                  <PendingRow nodeLabel={nodeLabel} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      )}
    </MessageScrollerProvider>
  );
}
