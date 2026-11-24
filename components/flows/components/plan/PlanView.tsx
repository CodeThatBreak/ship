'use client';
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { Artifact } from '@/types/flow';
import { useNodePanel } from '../../panels';
import { Button } from '@/components/ui/button';
import { FLOW_STATUS } from '@/constants/flow';

import { PlanPanelHeader } from './components/PlanPanelHeader';
import { PlanStatusPanel } from './components/PlanStatusPanel';
import { PlanViewTabs } from './components/PlanViewTabs';
import { ACTION_TYPES } from './constants/action';
import { PLAN_VIEW, type PlanView } from './constants/view';
import { usePlanAction } from './hooks/usePlanAction';

/**
 * The plan panel's container: only what the panel owns — the selection
 * reducer (`usePlanUi`) and the plan actions (`usePlanAction`) — composed with the pieces in
 * `components/`. Every piece derives its own view of the node and decides by
 * itself whether it renders; the raw panel `action` callback is gone — all
 * plan actions go through the `usePlanAction` mutation.
 *
 * The plan's runs and refinements are composer-driven — use the chat rail
 * to converse with the planning agent.
 */
export default function PlanView() {
  const { flow, node } = useNodePanel();
  const plans = useMemo(() => node.artifacts.filter((a: Artifact) => a.kind === 'plan'), [node.artifacts]);
  const { state, onAction } = usePlanAction(flow.id);
  const [activeView, setActiveView] = useState<PlanView>(PLAN_VIEW.PLAN);

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

      <div className="shrink-0 px-5 pt-4 empty:hidden">
        <PlanStatusPanel node={node} plans={plans} onAction={onAction} />
      </div>

      <PlanViewTabs
        activeView={activeView}
        onViewChange={setActiveView}
        node={node}
        plans={plans}
        planId={current?.id ?? null}
        isCurrent={isCurrent}
        onVersionSelect={onTabSelection}
        steps={flow.planSteps ?? []}
        editable={awaiting}
        flowId={flow.id}
      />

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
