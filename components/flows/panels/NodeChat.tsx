"use client";
import ChatPanel from '@/components/chat/feed/ChatPanel';
import ChatPanelSkeleton from '@/components/chat/feed/ChatPanelSkeleton';
import { InlineError } from '@/components/shared/InlineError';
import { useNodePanel } from "./context";
import { useNodeChatBindings } from "./hooks/useNodeChatBindings";
import { useNodePromptPrefill } from "./hooks/useNodePromptPrefill";

/** The composer's copy while the node awaits its first run (the prompt preview/edit). */
const FIRST_RUN_PLACEHOLDER = 'Review the prompt, then send to run';

/**
 * A node's standard chat rail: the generic ChatPanel wired to the selected
 * node through the panel context. The plan node's rail lives in the plan
 * feature (`PlanNodeChat`); this is the default for the other agent-backed
 * nodes. `capabilities.promptNode` puts the rail into the Composer-as-Prompt
 * mode for a first run — the composer prefills the node's prompt body, the
 * first message IS the run's prompt; turns after a run are refines (the
 * capabilities gate everything — no node-key checks).
 */
export default function NodeChat() {
  const { flow, node, events, modelChoice, setModelChoice } = useNodePanel();
  const { busy, nodeKeysByNodeId, nodeStatusByNodeId } = useNodeChatBindings();
  const { firstRun, prefill, isLoading, error, retry } = useNodePromptPrefill();

  // the first-run prompt read seeds the composer at mount (the composer keeps
  // its own draft state) — the rail renders the matched skeleton until it lands
  if (firstRun && isLoading) {
    return <ChatPanelSkeleton />;
  }

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
      initialDraft={firstRun ? (prefill ?? undefined) : undefined}
      sendLabel={firstRun ? (node.capabilities?.startLabel ?? 'Send') : 'Send'}
      placeholder={firstRun ? FIRST_RUN_PLACEHOLDER : undefined}
      // key remount seeds the composer's draft once a failed prefill read
      // recovers (the retry refetch flips the rail's settle state)
      key={error ? 'prompt-error' : 'prompt-ready'}
      error={error ? <InlineError message={error} onRetry={retry} /> : undefined}
    />
  );
}
