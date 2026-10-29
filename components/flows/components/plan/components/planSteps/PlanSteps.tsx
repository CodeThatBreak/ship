"use client";
import { ListChecks, Pencil, Plus, Save, X } from "lucide-react";
import type { PlanStepRow } from "@/types/flow";
import { PLAN_STEP_ACTION, PLAN_STEP_STATUS } from "../../constants";
import { PlanStepItem } from "./PlanStepItem";
import { PlanStepDraftRow } from "./PlanStepDraftRow";
import { usePlanStepDrafts } from "../../hooks/usePlanStepDrafts";
import { usePlanAction } from "../../hooks/usePlanAction";
import { Button } from "@/components/ui/button";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";

/**
 * The editable structured-plan checklist, laid out per the shadcn ai-elements
 * Plan pattern: a Trace Collapsible whose trigger line shows the progress count
 * and whose content holds the progress bar + steps. The checklist owns its
 * step actions — a `usePlanAction` mutation against the flow's action route.
 * Steps are persisted immediately on toggle; title/detail/files edits happen
 * in a draft mode committed with Save. Header action buttons sit *beside* the
 * trigger, never inside it.
 */
export default function PlanSteps({
  steps,
  editable,
  flowId,
  highlight,
  className,
}: {
  steps: PlanStepRow[];
  editable: boolean;
  /** the owning flow — the route the step actions POST to */
  flowId: string;
  highlight?: boolean; // build node: shown as progress tracker
  className?: string;
}) {
  const onAction = usePlanAction(flowId);
  const { editing, drafts, startEdit, cancel, save, patch, addDraft, removeAt } =
    usePlanStepDrafts(steps, onAction);

  if (!steps.length && !editable) return null;

  const done = steps.filter((s) => s.status === PLAN_STEP_STATUS.DONE).length;
  const allDone = steps.length > 0 && done === steps.length;
  const canToggle = Boolean(editable || highlight);
  const toggleStep = (s: PlanStepRow) =>
    onAction({
      type: PLAN_STEP_ACTION.SET,
      payload: {
        stepId: s.id,
        status:
          s.status === PLAN_STEP_STATUS.DONE
            ? PLAN_STEP_STATUS.PENDING
            : PLAN_STEP_STATUS.DONE,
      },
    });

  return (
    <Trace className={cn("min-w-0", className)}>
      <TraceCollapsible defaultOpen>
        {/* header row — action buttons render beside the trigger, not inside it */}
        <div className="flex w-full items-center justify-between gap-2">
          <TraceCollapsibleTrigger className="min-w-0">
            <TraceLine>
              <TraceIcon>
                <ListChecks />
              </TraceIcon>
              <TraceTitle className="text-sm font-semibold text-foreground">
                Plan checklist
              </TraceTitle>
              {steps.length > 0 && (
                <TraceDescription
                  className={allDone ? "text-success/80" : undefined}
                >
                  {done}/{steps.length} done
                </TraceDescription>
              )}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-1">
            {editable && !editing && (
              <Button size="xs" variant="secondary" onClick={startEdit}>
                <Pencil size={13} /> Edit steps
              </Button>
            )}
            {editing && (
              <>
                <Button size="xs" variant="secondary" onClick={cancel}>
                  <X size={13} /> Cancel
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={save}
                  disabled={!drafts.some((d) => d.title.trim())}
                >
                  <Save size={13} /> Save steps
                </Button>
              </>
            )}
          </div>
        </div>

        <TraceCollapsibleContent>
          {/* view mode */}
          {!editing && (
            <div className="grid gap-1 py-1">
              {steps.map((s) => (
                <PlanStepItem
                  key={s.id}
                  step={s}
                  canToggle={canToggle}
                  onToggle={toggleStep}
                />
              ))}
              {steps.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  No steps yet — Edit steps to build the checklist by hand.
                </p>
              )}
            </div>
          )}

          {/* edit mode */}
          {editing && (
            <div className="grid gap-2.5">
              {drafts.map((d, i) => (
                <PlanStepDraftRow
                  key={i}
                  draft={d}
                  index={i}
                  onPatch={patch}
                  onRemove={removeAt}
                />
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                onClick={addDraft}
              >
                <Plus size={13} /> Add step
              </Button>
            </div>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
