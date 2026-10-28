"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Plan-node failure banner. Plan output-contract failures are loud now: the
 * run's AgentOutputError (the first schema violation, the agent's own reason,
 * or "no JSON") is the error event in the activity feed, and the node failed
 * without publishing a new artifact version.
 */
export function PlanFailureAlert({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle size={16} className="shrink-0" />
      <div className="flex-1">
        <span className="font-medium">Plan generation failed</span>
        <p className="text-xs mt-1 mb-0">
          The agent response didn&apos;t satisfy the plan output contract — the
          activity feed shows what came back. The previous plan version is
          still the latest.
        </p>
      </div>
      <Button size="sm" onClick={onRetry}>
        <RotateCcw size={13} /> Retry
      </Button>
    </Alert>
  );
}
