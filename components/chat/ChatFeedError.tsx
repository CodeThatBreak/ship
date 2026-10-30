import { CircleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function ChatFeedError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-start gap-2 px-4 py-4" role="alert">
      <span className="inline-flex items-center gap-1.5 text-[13px] text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" />
        {message ?? "Couldn't load the chat."}
      </span>
      <Button size="xs" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
