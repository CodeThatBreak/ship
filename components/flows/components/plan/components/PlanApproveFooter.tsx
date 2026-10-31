'use client';
import { Check, ChevronDown } from 'lucide-react';
import { EXECUTION_KNOB, EXECUTION_MODE, EXECUTION_SOURCE, type PlanExecutionMode } from '../constants';
import { executionLabel } from '../utils/planExecution';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Plan fan-out (§1): approve with execution choice when the plan has branches.
 * Split button: the main segment approves with the resolved default mode,
 * the chevron menu approves directly with either mode (no separate pick state).
 */
export const PlanApproveFooter = ({
  publishedResolution,
  publishedSource,
  plannerRationale,
  knob,
  branchCount,
  showExecutionChoice,
  onApprove,
}: {
  /** effective resolution from plan-meta + knob (used as the split button default) */
  publishedResolution: PlanExecutionMode;
  publishedSource: string;
  plannerRationale: string | null;
  knob: string | undefined;
  branchCount: number;
  showExecutionChoice: boolean;
  onApprove: (mode: PlanExecutionMode) => void;
}) => {
  const modes = [EXECUTION_MODE.WHOLE, EXECUTION_MODE.STEPS] as const;

  const shortLabel = (mode: PlanExecutionMode) => (mode === EXECUTION_MODE.WHOLE ? 'Single run' : `Per branch`);

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
      <div className="flex-1" />
      {showExecutionChoice ? (
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <ButtonGroup className="shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="br-0"
                  title={executionLabel(publishedResolution, branchCount)}
                >
                  <Check size={14} />
                  Approve Plan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="px-2 border-l border-primary-foreground/30"
                  aria-label="Choose how to run the plan"
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
              </ButtonGroup>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" side="top" className="w-64">
              {modes.map(mode => (
                <DropdownMenuItem key={mode} onSelect={() => onApprove(mode)} className="items-start gap-2">
                  <Check
                    size={14}
                    aria-hidden="true"
                    className={cn('mt-0.5 shrink-0', mode === publishedResolution ? 'opacity-100' : 'opacity-0')}
                  />
                  <div className="flex flex-col min-w-0">
                    <span>{shortLabel(mode)}</span>
                    <span className="text-xs text-muted-foreground">{executionLabel(mode, branchCount)}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {plannerRationale && knob === EXECUTION_KNOB.FOLLOW && (
            <span className="text-[11.5px] text-muted-foreground truncate min-w-0" title={plannerRationale}>
              planner: “{plannerRationale}”
            </span>
          )}
          {publishedSource === EXECUTION_SOURCE.OVERRIDE && (
            <span className="text-[11.5px] text-muted-foreground shrink-0">(overridden at the last approve)</span>
          )}
        </div>
      ) : (
        <Button variant="default" size="sm" onClick={() => onApprove(EXECUTION_MODE.WHOLE)}>
          <Check size={15} /> Approve plan
        </Button>
      )}
    </div>
  );
};
