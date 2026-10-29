'use client';
import { CircleStop } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Running plan state: the headline distinguishes first generation from a refine. */
export function PlanRunningState({
  hasPlans,
  onStop,
}: {
  hasPlans: boolean;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-5 py-20 gap-1">
      <p className="text-muted-foreground text-sm font-medium m-0 shimmer">
        {hasPlans ? 'Agent is reworking the plan...' : 'Agent is cooking up the plan...'}
      </p>

      <Button size="sm" variant="destructive" className="mt-1" onClick={onStop}>
        <CircleStop size={12} /> Stop agent
      </Button>
    </div>
  );
}
