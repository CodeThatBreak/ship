import { InputGroupButton } from '@/components/ui/input-group';
import { Square } from 'lucide-react';

type Props = {
  onStop: () => void;
  disabled?: boolean;
};

/** The composer's stop affordance: replaces the send button while the node's
 *  agent is running, firing the same cancel action the panel used to offer. */
export function StopButton({ onStop, disabled }: Props) {
  return (
    <InputGroupButton
      type="button"
      size="icon-sm"
      className="ml-auto rounded-full"
      disabled={disabled}
      aria-label="Stop agent"
      onClick={onStop}
    >
      <Square className="size-3 fill-current" />
      <span className="sr-only">Stop agent</span>
    </InputGroupButton>
  );
}
