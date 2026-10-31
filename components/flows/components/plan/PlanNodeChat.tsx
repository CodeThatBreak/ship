'use client';
import { useMemo } from 'react';
import ChatPanel from "@/components/chat/ChatPanel";
import ChatPanelSkeleton from "@/components/chat/ChatPanelSkeleton";
import { useNodePanel, useNodeChatBindings } from '../../panels';
import { usePlanComposer } from './hooks/usePlanComposer/planComposerExports';
import type { BranchPlan } from './types/planTypes';

import { MAIN_THREAD_CONFIG, REFINE_HINT } from './constants/thread';

/**
 * The plan node's chat rail (docs/architecture/plan-unified-turns.md): main
 * and branch conversation tabs; sends always go through `POST /chat` with
 * optional `thread`. The factory only renders this rail when
 * `capabilities.chatMode === 'plan'`.
 */
export default function PlanNodeChat() {
  const { flow, node, events, modelChoice, setModelChoice } = useNodePanel();
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

  const { activeThreadId, prompts, chatInputRef, onAction, isPromptsLoading } = usePlanComposer({
    flowId: flow.id,
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
    />
  );
}
