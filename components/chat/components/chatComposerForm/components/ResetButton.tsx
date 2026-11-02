import { Button } from '@/components/ui/button';
import { RotateCcwIcon } from 'lucide-react';

type Props = {
  onReset: () => void;
};

export function ResetButton({ onReset }: Props) {
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      className="h-5 px-1.5 text-[11px] text-muted-foreground"
      onClick={onReset}
    >
      <RotateCcwIcon className="size-3" /> Reset to template
    </Button>
  );
}
