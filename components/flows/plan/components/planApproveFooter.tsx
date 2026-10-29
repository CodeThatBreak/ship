"use client";
import { Check } from "lucide-react";
import {
  EXECUTION_KNOB,
  EXECUTION_MODE,
  EXECUTION_SOURCE,
  type ExecutionMode,
} from "../constants";
import { Button } from "@/components/ui/button";

/**
 * Plan fan-out (§1): the approve footer — the published execution resolution
 * with the override control (Phase 3B). Forcing whole/steps at approve is
 * recorded as executionSource "override" in the approved plan version's
 * plan-meta, and a downstream from-plan fan-out node honors it.
 */
export function PlanApproveFooter({
  pick,
  onPick,
  note,
  publishedSource,
  plannerRationale,
  knob,
  stepCount,
  onApprove,
}: {
  pick: ExecutionMode;
  onPick: (mode: ExecutionMode) => void;
  /** the "will execute" label of the current resolution */
  note: string;
  /** who decided the published value ("planner" | "override" | "unknown") */
  publishedSource: string;
  /** the planner's one-line rationale, when published by the planner */
  plannerRationale: string | null;
  /** the plan node's raw `execution_default` knob */
  knob: string | undefined;
  /** branch (or step-fallback) count a per-branch execution would run */
  stepCount: number;
  onApprove: (pick: ExecutionMode) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
          will execute:
        </span>
        <div className="flex overflow-hidden rounded-lg border border-border text-[12px] shrink-0">
          {([EXECUTION_MODE.WHOLE, EXECUTION_MODE.STEPS] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={
                pick === v
                  ? "px-2.5 py-1 bg-info/10 text-info"
                  : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
              }
              title={v === EXECUTION_MODE.WHOLE
                ? "Force the whole plan into one run"
                : `Force per-branch execution (${stepCount} child flow${stepCount === 1 ? "" : "s"})`}
              onClick={() => onPick(v)}
            >
              {v === pick
                ? note
                : v === EXECUTION_MODE.WHOLE
                  ? "one run"
                  : "per-branch"}
            </button>
          ))}
        </div>
      </div>
      {(plannerRationale && knob === EXECUTION_KNOB.FOLLOW) && (
        <span className="text-[11.5px] text-muted-foreground truncate min-w-0" title={plannerRationale}>
          planner: “{plannerRationale}”
        </span>
      )}
      {publishedSource === EXECUTION_SOURCE.OVERRIDE && (
        <span className="text-[11.5px] text-muted-foreground shrink-0">
          (overridden at the last approve)
        </span>
      )}
      <div className="flex-1" />
      <Button variant="default" onClick={() => onApprove(pick)}>
        <Check size={15} /> Approve plan
      </Button>
    </div>
  );
}
