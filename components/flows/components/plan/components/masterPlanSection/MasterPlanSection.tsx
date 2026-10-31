'use client';
import { Info, Layers, RotateCcw } from 'lucide-react';
import { Markdown } from "@/components/shared/Markdown";
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useArtifact } from '../../../../hooks/useArtifact';
import { MasterPlanLoader } from './MasterPlanLoader';

/** The section's heading — hoisted, shared by the loading/error/success rows. */
const MASTER_PLAN_HEADING = (
  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
    <Layers size={14} /> Master plan
  </h3>
);

/**
 * The master plan (level 1): the selected plan version's markdown document,
 * with the refine-feedback provenance tooltip (§6c). Async states per
 * AGENTS §2.8 — the loader mirrors the final layout, an error offers a
 * retry, and an empty document is called out explicitly.
 */
export function MasterPlanSection({ planId }: { planId: string }) {
  const { data: artifact, isPending, isError, refetch } = useArtifact(planId);

  // loading: a skeleton that mirrors the final layout (§2.8)
  if (isPending) return <MasterPlanLoader />;

  // error / empty: a message plus a retry action
  if (isError || !artifact?.content) {
    return (
      <div>
        {MASTER_PLAN_HEADING}
        <Card className="px-4 py-4">
          <div role="alert" className="flex items-center gap-3">
            <span className="flex-1 min-w-0 text-xs text-muted-foreground">
              {isError ? 'The plan document could not be loaded.' : 'The plan document is empty.'}
            </span>
            {isError && (
              <Button size="xs" variant="outline" onClick={() => void refetch()}>
                <RotateCcw size={12} /> Retry
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const feedback =
    typeof artifact.meta?.feedback === "string" ? artifact.meta.feedback : null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Layers size={14} /> Master plan
        {feedback ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" aria-label="Plan refinement feedback" className="inline-flex" />
              }
            >
              <Info size={12} className="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <div className="border-l-[3px] pl-2.5 text-xs text-muted-foreground">
                Refined from feedback: &quot;{feedback}&quot;
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </h3>

      <Card className="px-4 py-4">
        <Markdown className="text-[13px]">{artifact.content}</Markdown>
      </Card>
    </div>
  );
}
