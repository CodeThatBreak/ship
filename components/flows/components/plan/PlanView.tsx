'use client';
import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { Artifact } from '@/types/flow';
import { useNodePanel } from '../../panels';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FLOW_STATUS } from '@/constants/flow';

import { PlanPanelHeader } from './components/PlanPanelHeader';
import { PlanStatusPanel } from './components/PlanStatusPanel';
import { PlanVersionTabs } from './components/PlanVersionTabs';
import { WholeDiffBanner } from './components/WholeDiffBanner';
import { PlanSection } from './components/PlanSection';
import PlanSteps from './components/planSteps/PlanSteps';
import { ACTION_TYPES } from './constants/action';
import { usePlanAction } from './hooks/usePlanAction';

/**
 * The plan panel's container: only what the panel owns — the selection
 * reducer (`usePlanUi`) and the plan actions (`usePlanAction`) — composed with the pieces in
 * `components/`. Every piece derives its own view of the node and decides by
 * itself whether it renders; the raw panel `action` callback is gone — all
 * plan actions go through the `usePlanAction` mutation.
 *
 * The plan's runs and refinements are composer-driven — use the chat rail
 * (main or branch tab) to converse; branch changes send with `thread` set
 * to the branch name.
 */
export default function PlanView() {
  const { flow, node } = useNodePanel();
  const plans = useMemo(() => node.artifacts.filter((a: Artifact) => a.kind === 'plan'), [node.artifacts]);
  const { state, onAction } = usePlanAction(flow.id);

  const { selectedId } = state;

  const current = useMemo(
    () => plans.find(a => a.id === selectedId) ?? plans[plans.length - 1] ?? null,
    [plans, selectedId]
  );

  // diff banners and approve only apply to the newest version being viewed
  const isCurrent = Boolean(current?.id === plans[plans.length - 1]?.id);
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const showApprove = awaiting && isCurrent;

  const onApprove = () => onAction({ type: ACTION_TYPES.APPROVE, payload: {} });

  const onTabSelection = (id: string) => onAction({ type: ACTION_TYPES.SELECT_VERSION, payload: { id } });

  return (
    <div className="flex flex-col h-full min-h-0">
      <PlanPanelHeader node={node} />

      <ScrollArea className="flex-1">
        <div className="px-5 py-4 flex flex-col gap-4 h-full">
          <PlanStatusPanel node={node} plans={plans} onAction={onAction} />
          <PlanVersionTabs plans={plans} selectedId={current?.id ?? null} onSelection={onTabSelection} />
          <WholeDiffBanner plans={plans} isCurrent={isCurrent} />
          <PlanSection planId={current?.id} />
          <PlanSteps steps={flow.planSteps ?? []} editable={awaiting} flowId={flow.id} />
        </div>
      </ScrollArea>

      {showApprove && (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
          <div className="flex-1" />
          <Button variant="default" size="sm" onClick={onApprove}>
            <Check size={15} /> Approve plan
          </Button>
        </div>
      )}
    </div>
  );
}
