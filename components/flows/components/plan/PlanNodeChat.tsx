'use client';
import { useMemo, useState } from 'react';
import { ChatPanel } from '@/components/chat';
import type { PlanOptions } from '@/components/chat';
import { useNodePanel, useNodeChatBindings } from '../../panels';
import { usePlanComposer } from './hooks/usePlanComposer';
import type { BranchPlan } from './types';

/**
 * The plan node's chat rail (docs/plan-conversation-refine.md §4d): the plan
 * feature builds its own composer config here — the three composer states and
 * the refinement tabs — instead of the cockpit deciding for it. The hook
 * inside is a no-op for nodes without the plan chat mode; the factory only
 * renders this rail for the plan node (capabilities.chatMode === 'plan').
 */
export default function PlanNodeChat() {
  const { flow, node, events, model, modelChoice, setModelChoice } = useNodePanel();
  const { busy, nodeKeysByNodeId, nodeStatusByNodeId } = useNodeChatBindings();

  // plan-generation options — toggled in the composer's prompt-state aside,
  // part of the plan node's contract input. Feature-local state: the cockpit
  // doesn't need to know the plan node's options exist.
  const [planOptions, setPlanOptions] = useState<PlanOptions>({ decompose: false });

  // one conversation tab per sub plan branch (the latest plan's fan-out)
  const branchNames = useMemo(
    () => (node.output?.branches as BranchPlan[] | null)?.map(b => b.name) ?? [],
    [node.output?.branches]
  );

  const { composer, tabs } = usePlanComposer({
    flowId: flow.id,
    nodeKey: node.node_key,
    nodeStatus: node.status,
    artifactCount: node.artifacts.length,
    capabilities: node.capabilities ?? null,
    planOptions,
    setPlanOptions,
    model,
    branchNames,
  });

  return (
    <ChatPanel
      flowId={flow.id}
      nodeKey={node.node_key}
      nodeLabel={node.label ?? node.template_name ?? node.node_key}
      capabilities={node.capabilities}
      busy={busy}
      events={events}
      nodeKeysByNodeId={nodeKeysByNodeId}
      nodeStatusByNodeId={nodeStatusByNodeId}
      modelChoice={modelChoice}
      composer={composer}
      tabs={tabs}
      onAction={() => {}}
    />
  );
}
