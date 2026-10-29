'use client';
import { ArrowRightLeft, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { BranchPlan } from '../../types';
import type { ScopedDiff } from '../../utils/branchDiff';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Markdown } from '@/components/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * One branch sub-plan card: a toggle row (branch name, title, scoped-refine
 * provenance and staleness badges), a compact meta row, and — when expanded —
 * the branch's bounded scrollable document (§6/§7.3, §8).
 */
export function SubPlanCard({
  branch,
  expanded,
  scopedDiff,
  staleVersion,
  canRefine,
  onToggle,
  onRefine,
}: {
  branch: BranchPlan;
  expanded: boolean;
  /** diff banner data when this branch was scoped-refined (null otherwise) */
  scopedDiff: ScopedDiff | null;
  /** version of the scoped refine newer than the overview, when stale (§8) */
  staleVersion?: number;
  canRefine: boolean;
  onToggle: (name: string) => void;
  onRefine: (name: string) => void;
}) {
  const refined = scopedDiff && scopedDiff.branch === branch.name ? scopedDiff : null;
  const dependsOn = branch.dependsOn ?? [];
  const subPlanSteps = branch.subPlan?.steps ?? [];
  return (
    <Card className="px-3.5 py-2.5 gap-0">
      <button className="w-full flex items-center gap-2 text-left min-w-0" onClick={() => onToggle(branch.name)}>
        {expanded ? (
          <ChevronDown size={13} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-muted-foreground shrink-0" />
        )}
        <Badge className="bg-info/10 text-info shrink-0">{branch.name}</Badge>
        <span className="font-medium text-[13px] truncate">{branch.title}</span>
        <span className="flex-1" />

        {refined && (
          <Tooltip>
            <TooltipTrigger>
              <Badge className="bg-warning/10 text-warning shrink-0">
                <ArrowRightLeft size={10} /> refined v{refined.from} → v{refined.to}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              This branch was refined by a scoped run (v
              {refined.from} → v{refined.to}):{' '}
              {[
                refined.diff.changed.length
                  ? `${refined.diff.changed.length} step${refined.diff.changed.length > 1 ? 's' : ''} changed`
                  : null,
                refined.diff.added.length ? `${refined.diff.added.length} added` : null,
                refined.diff.removed.length ? `${refined.diff.removed.length} removed` : null,
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              — other branches untouched
            </TooltipContent>
          </Tooltip>
        )}
        {staleVersion && !refined && (
          <Tooltip>
            <TooltipTrigger>
              <Badge className="bg-warning/10 text-warning shrink-0">● sub-plan refined v{staleVersion}</Badge>
            </TooltipTrigger>
            <TooltipContent>
              This branch&apos;s document was refined by a scoped run (v{staleVersion}) newer than the overview
              you&apos;re viewing
            </TooltipContent>
          </Tooltip>
        )}
      </button>
      {/* one compact meta row: scope · depends on · counts · refine */}
      <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground mt-1.5">
        {branch.scope && (
          <span className="truncate min-w-0" title={branch.scope}>
            {branch.scope}
          </span>
        )}
        {dependsOn.length > 0 && (
          <span className="shrink-0" title={dependsOn.join(', ')}>
            ↳ depends on: {dependsOn.join(', ')}
          </span>
        )}
        <span className="flex-1" />
        {canRefine && (
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="xs"
                variant="secondary"
                className="shrink-0"
                onClick={e => {
                  e.stopPropagation();
                  onRefine(branch.name);
                }}
              >
                <Pencil size={11} /> Refine
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Prefill the chat composer with this branch&apos;s scoped refine prompt — the agent rewrites ONE branch,
              not the whole plan; everything else stays untouched
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {expanded && (
        <div className="mt-2 pt-1.5 border-t border-border">
          {/* bounded scrollable doc — expanding doesn't stretch the card */}
          <ScrollArea className="max-h-72">
            {branch.markdown ? (
              <Markdown className="text-[13px]">{branch.markdown}</Markdown>
            ) : (
              <div className="px-1">
                <p className="text-xs text-muted-foreground mb-1.5">
                  No branch document yet — refined sub-plans write one. The main plan still covers this branch.
                </p>
                {branch.subPlan?.prompt && (
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="text-muted-foreground">Sub-plan prompt:</span> {branch.subPlan.prompt}
                  </p>
                )}
                {subPlanSteps.length > 0 && (
                  <p className="text-xs text-muted-foreground">{subPlanSteps.length} sub-plan steps</p>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </Card>
  );
}
