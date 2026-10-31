'use client';

import { Compass } from 'lucide-react';

import { EmptyHint } from "@/components/shared/EmptyHint";

/** Pending plan state: the plan prompt preview lives over the chat panel. */
export const PlanEmptyHint = () => {
  return (
    <div className="flex flex-1 items-center justify-center py-1">
      <EmptyHint icon={Compass} className="py-1">
        No plans yet. Use the chat input to generate a plan. A default prompt is already filled in, so review
        it and make any changes you want.
      </EmptyHint>
    </div>
  );
};
