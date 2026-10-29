'use client';
import { Compass } from 'lucide-react';

/** Pending plan state: the plan prompt preview lives over the chat panel. */
export function PlanEmptyHint() {
  return (
    <div className="flex flex-1 items-center justify-center py-1">
      <div className="text-center px-5">
        <Compass size={32} className="text-muted-foreground mb-3 mx-auto" />
        <p className="text-muted-foreground max-w-[380px] mx-auto">
          No plans yet. Use the chat input to generate a plan. A default prompt is already filled in, so review it and
          make any changes you want.
        </p>
      </div>
    </div>
  );
}
