"use client";

import { ListChecks } from "lucide-react";
import type { PlanStepRow } from "@/types/flow";
import { EmptyHint } from "@/components/shared/EmptyHint";
import PlanSteps from "@/components/flows/components/plan/components/planSteps/PlanSteps";

/** The build node's structured plan progress. */
export function BuildStepsContent({ steps, flowId }: { steps: PlanStepRow[]; flowId: string }) {
  if (steps.length === 0) {
    return <EmptyHint icon={ListChecks}>No steps yet.</EmptyHint>;
  }

  return <PlanSteps steps={steps} editable={false} highlight flowId={flowId} />;
}
