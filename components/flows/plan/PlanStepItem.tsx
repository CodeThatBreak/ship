"use client";
import { Check, CheckCircle2, Circle } from "lucide-react";
import type { PlanStepRow } from "@/types/flow";
import { PLAN_STEP_COMPLETED_BY, PLAN_STEP_ORIGIN, PLAN_STEP_STATUS } from "./constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One read-only checklist row: the toggle control, struck-through text when
 * done, branch/origin markers, and the touched files.
 */
export function PlanStepItem({
  step,
  canToggle,
  onToggle,
}: {
  step: PlanStepRow;
  canToggle: boolean;
  onToggle: (step: PlanStepRow) => void;
}) {
  const isDone = step.status === PLAN_STEP_STATUS.DONE;
  return (
    <div
      className="flex items-start gap-2.5 py-1.5 group"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!canToggle}
        title={isDone ? "Mark as not done" : "Mark as done"}
        onClick={() => onToggle(step)}
        className={cn(
          "mt-[1px] shrink-0",
          isDone
            ? "text-success hover:text-success"
            : "text-muted-foreground hover:text-info",
          !canToggle && "cursor-default",
        )}
      >
        {isDone ? (
          <CheckCircle2 size={17} />
        ) : (
          <Circle size={17} />
        )}
      </Button>
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-[13px] leading-snug text-foreground",
            isDone && "line-through text-muted-foreground",
          )}
        >
          {step.title}
        </span>
        {step.detail && (
          <p
            className={cn(
              "text-xs text-muted-foreground mt-0.5 mb-0 leading-snug",
              isDone && "line-through",
            )}
          >
            {step.detail}
          </p>
        )}
        <span className="flex gap-1 mt-1 flex-wrap">
          {step.branch && (
            <Badge className="bg-violet-500/10 text-violet-400">
              {step.branch}
            </Badge>
          )}
          {step.completed_by === PLAN_STEP_COMPLETED_BY.BUILD && isDone && (
            <Badge className="bg-success/10 text-success">
              <Check size={10} /> by build
            </Badge>
          )}
          {step.origin === PLAN_STEP_ORIGIN.USER && <Badge>manual</Badge>}
          {(step.files ?? []).map((f) => (
            <code
              key={f}
              className="text-[11px] text-muted-foreground bg-card border border-border rounded-lg px-1 py-px"
            >
              {f}
            </code>
          ))}
        </span>
      </div>
    </div>
  );
}
