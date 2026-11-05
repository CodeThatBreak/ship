import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

import { ArrowUpIcon, LoaderCircleIcon } from 'lucide-react';

type Props = {
  sendLabel: string;
  canSend: boolean;
  /** a send is in flight — swaps the arrow for a spinner */
  sending?: boolean;
};

export function SendButton({ sendLabel, canSend, sending }: Props) {
  return (
    <InputGroupButton
      type="submit"
      size="icon-sm"
      className={cn('ml-auto rounded-full', sendLabel !== 'Send' && '!w-auto px-3')}
      disabled={!canSend}
      aria-label={sending ? 'Sending' : sendLabel}
      aria-busy={sending}
    >
      {sending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}

      {sendLabel === 'Send' ? (
        <span className="sr-only">Send</span>
      ) : (
        <span className="text-xs font-medium">{sendLabel}</span>
      )}
    </InputGroupButton>
  );
}
