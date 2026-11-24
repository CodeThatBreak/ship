'use client';
import { useMemo, useState } from 'react';
// value from lib/modelSpec (pure helpers, Phase 0 allowlist); the types flow
// through types/model-spec per the Phase 0 guidance
import { composeModelChoice } from '@/lib/modelSpec';
import type { ModelChoice } from '@/types/modelSpec';
import type { FeedEvent } from '@/components/chat/timeline';
import type { FlowData, Node } from '@/types/flow';
import { EXECUTION_MODE_LOCAL, LOCAL_MODE_MODEL } from '../../../constants';
import { NodePanelContext, type ActionPayload, type NodePanelContextValue } from '../../context';
import { resolveNodePanel } from '../../panelFactory';

/**
 * The node workspace dispatcher: the factory resolves the node's panel and its
 * chat rail (capability-driven), the context supplies every panel with the
 * shared surface — panels take no props and read it through `useNodePanel`.
 * The workspace pieces (panel + chat) resolve from `./panel-factory`; this
 * context is only the shared surface they run on.
 */
export default function NodePanel({
  flow,
  node,
  action,
  actionAsync,
  actionPending,
  actionError,
  resetAction,
  retryAction,
  events = [],
}: {
  flow: FlowData;
  node: Node;
  action: (a: string, b?: ActionPayload) => void;
  actionAsync: (a: string, b?: ActionPayload) => Promise<unknown>;
  actionPending: boolean;
  actionError: unknown;
  resetAction: () => void;
  retryAction: () => void;
  events?: FeedEvent[];
}) {
  // the flow-wide model override for this flow's runs — picked in the chat
  // panel's model selector, consumed by run-start action payloads in the
  // panels and by the plan composer. Local flows (mode picked at start)
  // prefill the local runtime's model; cloud stays on the account default (null).
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(
    flow.executionMode === EXECUTION_MODE_LOCAL ? { id: LOCAL_MODE_MODEL } : null
  );
  const model = composeModelChoice(modelChoice);

  const context = useMemo<NodePanelContextValue>(
    () => ({
      flow,
      node,
      action,
      actionAsync,
      actionPending,
      actionError,
      resetAction,
      retryAction,
      events,
      model,
      modelChoice,
      setModelChoice,
    }),
    [flow, node, action, actionAsync, actionPending, actionError, resetAction, retryAction, events, model, modelChoice]
  );

  const { panel: Panel, chat: Chat } = resolveNodePanel(node);

  return (
    <NodePanelContext.Provider value={context}>
      <div className="flex flex-1 min-h-0 min-w-0">
        {/* the node's panel column */}
        <div className="flex-[1.6] min-w-0 min-h-0 flex flex-col">
          <Panel key={node.nodeKey} />
        </div>
        {/* the node's chat rail — agent-backed nodes only, the plan node
            through the plan feature's composer config. The top/left/bottom
            insets stay here; the right edge stays open so the chat feed's
            scrollbar can run flush with the container's edge (like the app's
            ScrollArea) — the rail's children re-add their own right inset to
            keep the copy where it was. */}
        {Chat && (
          <div className="bg-card w-1/2  py-3.5 px-3.5 pr-0 min-h-0">
            <Chat key={node.nodeKey} />
          </div>
        )}
      </div>
    </NodePanelContext.Provider>
  );
}
