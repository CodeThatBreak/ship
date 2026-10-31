'use client';
import { useMemo } from 'react';
import type { Artifact } from '@/types/flow';
import { registerPanel } from '../panels/registry';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FLOW_STATUS } from '@/constants/flow';

import { PlanPanelHeader } from './components/PlanPanelHeader';
import { PlanStatusPanel } from './components/PlanStatusPanel';
import { PlanVersionTabs } from './components/PlanVersionTabs';
import { WholeDiffBanner } from './components/WholeDiffBanner';
import { PlanSection } from './components/PlanSection';
import { PlanApproveFooter } from './components/PlanApproveFooter';
import PlanSteps from './components/planSteps/PlanSteps';
import { PLAN_ACTION, type ExecutionMode } from './constants';
import { executionLabel, resolveExecution } from './utils/planExecution';
import { useExecutionPick } from './hooks/useExecutionPick';
import { usePlanAction } from './hooks/usePlanAction';
import { usePlanUi } from './hooks/usePlanUi';
import { planComposerBus } from './hooks/composerBus';
import type { PanelProps } from '../panels/registry';
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
  const { current, expandedBranch, selectVersion, toggleBranch, collapseBranch } = usePlanUi(plans);
  const onAction = usePlanAction(flow.id);

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

  // ── named events ─────────────────────────────────────────────────────────
  const onRetry = () => onAction({ type: PLAN_ACTION.RETRY, payload: { nodeKey: node.node_key } });
  const onStopAgent = () => onAction({ type: PLAN_ACTION.CANCEL, payload: { nodeKey: node.node_key } });
  // branch-scoped sub-plan refine (§7.1, now §4c): prefill the composer with
  // the scoped body — the collapse of the branch card happens with it
  const onBranchRefine = (name: string) => {
    collapseBranch();
    planComposerBus.prefillBranch(name);
  };
  const onRefine = () => planComposerBus.focusComposer();
  const onApprove = (pick: ExecutionMode) =>
    onAction({
      type: PLAN_ACTION.APPROVE,
      payload: { executionOverride: pick !== execution.published ? pick : undefined },
    });

  return (
    <div className="flex flex-col h-full min-h-0">
      <PlanPanelHeader node={node} onRefine={onRefine} />

      {/* scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4 flex flex-col gap-4 h-full">
          <PlanStatusPanel node={node} plans={plans} onRetry={onRetry} onStop={onStopAgent} />

          <PlanVersionTabs plans={plans} selectedId={current?.id ?? null} onSel={selectVersion} />

          <WholeDiffBanner plans={plans} isCurrent={isCurrent} />

          <PlanSection
            node={node}
            plans={plans}
            planId={current?.id}
            viewedVersion={current?.version ?? 0}
            expandedBranch={expandedBranch}
            canRefine={showApprove}
            onToggle={toggleBranch}
            onRefine={onBranchRefine}
          />

          {/* structured editable checklist — the machine-readable plan steps, at the bottom */}
          <PlanSteps steps={flow.planSteps ?? []} editable={awaiting} flowId={flow.id} />
        </div>
      </ScrollArea>

      {/* fixed footer */}
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
