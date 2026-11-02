import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

import { ArrowUpIcon } from 'lucide-react';

type Props = {
  sendLabel: string;
  canSend: boolean;
};

export function SendButton({ sendLabel, canSend }: Props) {
  return (
    <InputGroupButton
      type="submit"
      size="icon-sm"
      className={cn('ml-auto rounded-full', sendLabel !== 'Send' && '!w-auto px-3')}
      disabled={!canSend}
      aria-label={sendLabel}
    >
      <ArrowUpIcon />

      {sendLabel === 'Send' ? (
        <span className="sr-only">Send</span>
      ) : (
        <span className="text-xs font-medium">{sendLabel}</span>
      )}
    </InputGroupButton>
  );
}
