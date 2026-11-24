'use client';

import { useState } from 'react';
import { FileDiff, Gauge, GitMerge, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { PanelShell } from '../../components/shell/PanelShell';
import { useNodePanel } from '../../context';
import { BUILD_TAB, type BuildTab } from '../constants/tabs';
import { useBuildView } from './build/hooks/useBuildView';
import { BuildDiffContent } from './build/components/BuildDiffContent';
import { BuildStepsContent } from './build/components/BuildStepsContent';
import { PanelTabs } from './tabs/PanelTabs';
import { UsageArtifact } from './tabs/UsageArtifact';

const BUILD_TABS = [
  { value: BUILD_TAB.DIFF, label: 'Code diff', icon: FileDiff },
  { value: BUILD_TAB.STEPS, label: 'Steps', icon: ListChecks },
  { value: BUILD_TAB.USAGE, label: 'Usage', icon: Gauge },
] as const;

/**
 * The build panel: the agent's diff per branch, the structured plan checklist
 * progress, and the accept-and-create-MR action. "approved" means the user
 * clicked and the background task is running: MR creation first, then the
 * pipeline gate — the build stage stays in this busy state until the MR
 * exists (the engine reverts to awaiting_approval with an mr_failed event if
 * MR creation fails).
 */
export default function BuildView() {
  const { flow, node, action, events } = useNodePanel();
  const [activeTab, setActiveTab] = useState<BuildTab>(BUILD_TAB.DIFF);
  const model = useBuildView(flow, node, action, events);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {model.canApprove
          ? (model.singleErr ??
            (model.hasBranches
              ? 'Review each diff, then create the merge requests.'
              : 'Review the diff, then create the merge request.'))
          : model.creatingMr || model.creatingMrBranches.size > 0
            ? 'Creating the merge request — the pipeline stage starts once the MR exists.'
            : flow.mrUrl || model.hasBranches
              ? 'Merge request created.'
              : 'The diff appears here once the build finishes.'}
      </span>
      <div className="flex-1" />
      {model.canApprove && !model.hasBranches && (
        <Button onClick={model.approveAll}>
          <GitMerge size={14} /> {model.singleErr ? 'Retry: accept & create MR' : 'Accept & create MR'}
        </Button>
      )}
      {model.allAwaiting && (
        <Button onClick={model.approveAll}>
          <GitMerge size={14} /> Accept all & create MRs
        </Button>
      )}
    </>
  );

  return (
    <PanelShell
      node={node}
      flow={flow}
      hideCost
      fullBleedContent
      runningLabel="Agent is implementing the plan…"
      footer={footer}
    >
      <PanelTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Build views"
        tabs={BUILD_TABS}
      >
        <TabsContent value={BUILD_TAB.DIFF} className="px-5 pt-4 pb-4">
          <BuildDiffContent flow={flow} action={action} model={model} />
        </TabsContent>
        <TabsContent value={BUILD_TAB.STEPS} className="px-5 pt-4 pb-4">
          <BuildStepsContent steps={flow.planSteps ?? []} flowId={flow.id} />
        </TabsContent>
        <TabsContent value={BUILD_TAB.USAGE} className="px-5 pt-4 pb-4">
          <UsageArtifact node={node} />
        </TabsContent>
      </PanelTabs>
    </PanelShell>
  );
}
