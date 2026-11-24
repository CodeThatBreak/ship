'use client';

import { Gauge, FileText, ListChecks } from 'lucide-react';
import type { Artifact, Node, PlanStepRow } from '@/types/flow';
import { EmptyHint } from '@/components/shared/EmptyHint';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ARTIFACT_KIND } from '../../../panels/artifacts/constants/artifactKinds';
import { GenericArtifact } from '../../../panels/artifacts/components/GenericArtifact';
import { rendererForKind } from '../../../panels/artifacts/artifactRenderers';
import { PANEL_TABS_LIST_CLASS } from '../../../panels/constants/tabs';
import { PLAN_VIEW, type PlanView } from '../constants/view';
import PlanSteps from './planSteps/PlanSteps';
import { PlanSection } from './PlanSection';
import { PlanVersionTabs } from './PlanVersionTabs';
import { WholeDiffBanner } from './WholeDiffBanner';

/** The plan document, structured steps and run usage, shown one view at a time. */
export function PlanViewTabs({
  activeView,
  onViewChange,
  node,
  plans,
  planId,
  isCurrent,
  onVersionSelect,
  steps,
  editable,
  flowId,
}: {
  activeView: PlanView;
  onViewChange: (view: PlanView) => void;
  node: Node;
  plans: Artifact[];
  planId: string | null;
  isCurrent: boolean;
  onVersionSelect: (id: string) => void;
  steps: PlanStepRow[];
  editable: boolean;
  flowId: string;
}) {
  return (
    <Tabs
      value={activeView}
      onValueChange={view => {
        if (view === PLAN_VIEW.PLAN || view === PLAN_VIEW.STEPS || view === PLAN_VIEW.USAGE) {
          onViewChange(view);
        }
      }}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList variant="line" aria-label="Plan sections" className={PANEL_TABS_LIST_CLASS}>
        <TabsTrigger value={PLAN_VIEW.PLAN}>
          <FileText /> Plan
        </TabsTrigger>
        <TabsTrigger value={PLAN_VIEW.STEPS}>
          <ListChecks /> Steps
        </TabsTrigger>
        <TabsTrigger value={PLAN_VIEW.USAGE}>
          <Gauge /> Usage
        </TabsTrigger>
      </TabsList>

      <ScrollArea className="min-h-0 flex-1">
        <TabsContent value={PLAN_VIEW.PLAN} className="min-h-0">
          <div className="flex flex-col gap-4 px-5 pt-4 pb-4">
            <PlanVersionTabs plans={plans} selectedId={planId} onSelection={onVersionSelect} />
            <WholeDiffBanner plans={plans} isCurrent={isCurrent} />
            <PlanSection planId={planId} />
          </div>
        </TabsContent>

        <TabsContent value={PLAN_VIEW.STEPS} className="min-h-0">
          <div className="px-5 pt-4 pb-4">
            {steps.length === 0 && !editable ? (
              <EmptyHint icon={ListChecks}>No steps yet.</EmptyHint>
            ) : (
              <PlanSteps steps={steps} editable={editable} flowId={flowId} />
            )}
          </div>
        </TabsContent>

        <TabsContent value={PLAN_VIEW.USAGE} className="min-h-0">
          <div className="px-5 pt-4 pb-4">
            <GenericArtifact
              node={node}
              kind={ARTIFACT_KIND.USAGE}
              empty="No usage recorded yet."
              renderer={rendererForKind(ARTIFACT_KIND.USAGE)}
            />
          </div>
        </TabsContent>
      </ScrollArea>
    </Tabs>
  );
}
