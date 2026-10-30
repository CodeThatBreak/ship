'use client';
import { useMemo } from 'react';
import { ChatPanel, ChatPanelSkeleton } from '@/components/chat';
import { useNodePanel, useNodeChatBindings } from '../../panels';
import { usePlanComposer } from './hooks/usePlanComposer';
import type { BranchPlan } from './types';

import { MAIN_THREAD_CONFIG, REFINE_HINT } from './constants/thread';

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

  // Todo: Add a generic in usePaneNode
  const branches = node.output?.branches as BranchPlan[] | null;
  const threads = useMemo(() => {
    // If there are not branches, we don't need to show threads
    if (!branches?.length) return [];

    return [
      MAIN_THREAD_CONFIG,
      ...branches.map(({ name }) => ({
        id: name,
        label: name,
        emptyTitle: `Refine the “${name}” sub-plan`,
        emptyDescription: REFINE_HINT,
      })),
    ];
  }, [branches]);

  const { activeThreadId, prompts, chatInputRef, onAction, onSendChatMutationFn, isPromptsLoading } =
    usePlanComposer({
      flowId: flow.id,
      nodeKey: node.node_key,
      nodeStatus: node.status,
      artifactCount: node.artifacts.length,
      model,
    });

  if (isPromptsLoading) {
    return <ChatPanelSkeleton />;
  }

  return (
    <ChatPanel
      initialDraft={prompts?.[node.node_key]}
      flowId={flow.id}
      nodeKey={node.node_key}
      nodeLabel={node.label ?? node.template_name ?? node.node_key}
      capabilities={node.capabilities}
      busy={busy}
      events={events}
      nodeKeysByNodeId={nodeKeysByNodeId}
      nodeStatusByNodeId={nodeStatusByNodeId}
      modelChoice={modelChoice}
      setModelChoice={setModelChoice}
      threads={threads}
      activeThreadId={activeThreadId ?? undefined}
      onAction={onAction}
      chatInputRef={chatInputRef}
      sendMutationFn={onSendChatMutationFn}
    />
  );
}
