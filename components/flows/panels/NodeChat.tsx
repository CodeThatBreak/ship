"use client";
import ChatPanel from "@/components/chat/ChatPanel";
import { useNodePanel } from "./context";
import { useNodeChatBindings } from "./hooks/useNodeChatBindings";

/**
 * A node's standard chat rail: the generic ChatPanel wired to the selected
 * node through the panel context — no composer seam, the ChatPanel's standard
 * draft/send mechanics apply. The plan node's rail lives in the plan feature
 * (`PlanNodeChat`); this is the default for the other agent-backed nodes.
 */
export default function NodeChat() {
  const { flow, node, events, modelChoice, setModelChoice } = useNodePanel();
  const { busy, nodeKeysByNodeId, nodeStatusByNodeId } = useNodeChatBindings();

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
      setModelChoice={setModelChoice}
    />
  );
}
