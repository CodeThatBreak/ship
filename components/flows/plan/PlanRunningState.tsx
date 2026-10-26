"use client";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Running plan state: the headline distinguishes first generation from a refine. */
export function PlanRunningState({
  hasPlans,
  onStop,
}: {
  hasPlans: boolean;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-5 py-20 gap-3">
      <Spinner className="size-[22px] border-[3px]" />
      <p className="text-muted-foreground text-sm font-medium m-0">
        {hasPlans
          ? "Agent is reworking the plan…"
          : "Agent is cooking up the plan…"}
      </p>
      <p className="text-muted-foreground text-xs m-0">
        Grabbing coffee while it reads the repo — watch the activity feed
        →
      </p>
      <Button size="sm" variant="ghost" className="mt-1" onClick={onStop}>
        <Square size={12} /> Stop agent
      </Button>
    </div>
  );
}
