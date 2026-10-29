'use client';
import { useMemo } from 'react';
import type { Artifact } from '@/types/flow';
import { registerPanel } from '../../panels/registry';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FLOW_STATUS } from '@/constants/flow';

import { PlanPanelHeader } from './components/PlanPanelHeader';
import { PlanStatusPanel } from './components/PlanStatusPanel';
import { PlanVersionTabs } from './components/PlanVersionTabs';
import { WholeDiffBanner } from './components/WholeDiffBanner';
import { PlanSection } from './components/PlanSection';
import { PlanApproveFooter } from './components/PlanApproveFooter';
import PlanSteps from './components/planSteps/PlanSteps';
import { ACTION_TYPES } from './constants/action';
import type { ExecutionMode } from './constants';
import { executionLabel, resolveExecution } from './utils/planExecution';
import { useExecutionPick } from './hooks/useExecutionPick';
import { usePlanAction } from './hooks/usePlanAction';
import { planComposerBus } from './hooks/composerBus';
import type { PanelProps } from '../../panels/registry';
import type { BranchPlan } from './types';

/**
 * The plan panel's container: only what the panel owns — the selection
 * reducer (`usePlanUi`), the execution pick (`useExecutionPick`), and the
 * plan actions (`usePlanAction`) — composed with the pieces in
 * `components/`. Every piece derives its own view of the node and decides by
 * itself whether it renders; the raw panel `action` callback is gone — all
 * plan actions go through the `usePlanAction` mutation.
 *
 * The plan's runs and refinements are composer-driven
 * (docs/plan-conversation-refine.md §4) — the header's refine button focuses
 * the conversation composer and a branch card's Refine prefills the scoped
 * body, both dispatched through the plan composer bus (hooks/composerBus.ts).
 */
export default function PlanView({ flow, node }: Pick<PanelProps, 'flow' | 'node'>) {
  const plans = useMemo(() => node.artifacts.filter((a: Artifact) => a.kind === 'plan'), [node.artifacts]);
  const { state, onAction } = usePlanAction(flow.id);

  const { selectedId, expandedBranch } = state;

  const current = useMemo(
    () => plans.find(a => a.id === selectedId) ?? plans[plans.length - 1] ?? null,
    [plans, selectedId]
  );

  // diff banners and approve only apply to the newest version being viewed
  const isCurrent = Boolean(current?.id === plans[plans.length - 1]?.id);
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const showApprove = awaiting && isCurrent;

  // what the approve footer counts: fan-out branches when the plan fanned
  // out, its plan steps otherwise
  const branches = (node.output?.branches ?? null) as BranchPlan[] | null;
  const stepCount = branches ? branches.length : (flow.planSteps ?? []).length;

  const execution = resolveExecution(node, current?.meta);
  const [execPick, setExecPick] = useExecutionPick(
    execution.resolution,
    `${current?.id ?? ''}:${execution.resolution}`
  );

  const onRetry = () => onAction({ type: ACTION_TYPES.RETRY_AGENT, payload: { nodeKey: node.node_key } });
  const onStopAgent = () => onAction({ type: ACTION_TYPES.CANCEL_AGENT, payload: { nodeKey: node.node_key } });

  const onRefine = () => planComposerBus.focusComposer();
  const onApprove = (pick: ExecutionMode) =>
    onAction({
      type: ACTION_TYPES.APPROVE,
      payload: { executionOverride: pick !== execution.published ? pick : undefined },
    });

  const onTabSelection = (id: string) => onAction({ type: ACTION_TYPES.SELECT_VERSION, payload: { id } });

  return (
    <div className="flex flex-col h-full min-h-0">
      <PlanPanelHeader node={node} onRefine={onRefine} />

      <ScrollArea className="flex-1">
        <div className="px-5 py-4 flex flex-col gap-4 h-full">
          <PlanStatusPanel node={node} plans={plans} onAction={onAction} />
          <PlanVersionTabs plans={plans} selectedId={current?.id ?? null} onSelection={onTabSelection} />
          <WholeDiffBanner plans={plans} isCurrent={isCurrent} />
          <PlanSection
            node={node}
            plans={plans}
            planId={current?.id}
            viewedVersion={current?.version ?? 0}
            expandedBranch={expandedBranch}
            canRefine={showApprove}
            onAction={onAction}
          />
          <PlanSteps steps={flow.planSteps ?? []} editable={awaiting} flowId={flow.id} />
        </div>
      </ScrollArea>

      {showApprove && (
        <PlanApproveFooter
          pick={execPick}
          onPick={setExecPick}
          note={executionLabel(execution.resolution, stepCount)}
          publishedSource={execution.publishedSource}
          plannerRationale={execution.plannerRationale}
          knob={execution.knob}
          stepCount={stepCount}
          onApprove={onApprove}
        />
      )}
    </div>
  );
}

registerPanel({ type: 'plan' }, PlanView);
