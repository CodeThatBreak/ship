import { Skeleton } from '@/components/ui/skeleton';
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';

import ChatFeedSkeleton from './ChatFeedSkeleton';

/**
 * The chat rail's loading skeleton (AGENTS.md §2.8): mirrors the loaded
 * layout — the heading row (icon + title + caption), the tab strip, the
 * transcript feed and the composer with its model/send footer — same
 * paddings, same element count.
 */
export default function ChatPanelSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* heading — icon + title + truncated caption */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-2.5">
        <Skeleton className="size-4 shrink-0 rounded-full" />
        <Skeleton className="h-3.5 w-10" />
        <Skeleton className="h-3 w-32" />
      </div>

      {/* conversation tabs — a row of pill shapes */}
      <div className="shrink-0 flex items-center gap-1.5 px-1 pb-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      <ChatFeedSkeleton />

      {/* composer — textarea block + the footer with the model pick and send */}
      <div className="shrink-0 px-3 pb-4 pt-2">
        <InputGroup>
          <div className="flex-1 py-3 px-0.5">
            <Skeleton className="h-4 w-2/3 mb-1.5" />
          </div>
          <InputGroupAddon align="block-end">
            <Skeleton className="h-8 w-28 rounded-md" />
            <span className="flex-1" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
