'use client';
import ChatPanel from '@/components/chat/feed/ChatPanel';
import ChatPanelSkeleton from '@/components/chat/feed/ChatPanelSkeleton';
import { FLOW_ACTION } from '@/constants/flow';
import { useNodePanel, useNodeChatBindings } from '../../panels';
import { usePlanComposer } from './hooks/usePlanComposer/planComposerExports';

/**
 * The plan node's chat rail (docs/architecture/plan-unified-turns.md): a single
 * whole-plan conversation; sends always go through `POST /chat`. The factory
 * only renders this rail when `capabilities.chatMode === 'plan'`.
 */
export default function PlanNodeChat() {
  const { flow, node, events, modelChoice, setModelChoice, action, actionPending } = useNodePanel();
  const { busy, nodeKeysByNodeId, nodeStatusByNodeId } = useNodeChatBindings();

  const { prompts, isPromptsLoading } = usePlanComposer({ flowId: flow.id });

  if (isPromptsLoading) {
    return <ChatPanelSkeleton />;
  }

  return (
    <ChatPanel
      initialDraft={prompts?.[node.nodeKey]}
      flowId={flow.id}
      nodeKey={node.nodeKey}
      nodeLabel={node.label ?? node.templateName ?? node.nodeKey}
      capabilities={node.capabilities}
      busy={busy}
      events={events}
      nodeKeysByNodeId={nodeKeysByNodeId}
      nodeStatusByNodeId={nodeStatusByNodeId}
      modelChoice={modelChoice}
      setModelChoice={setModelChoice}
      onStop={() => action(FLOW_ACTION.CANCEL, { nodeKey: node.nodeKey })}
      stopDisabled={actionPending}
    />
  );
}
