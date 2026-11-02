'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveCockpitSelectedKey } from './utils/resolveCockpitSelection';
import { useQueryClient } from '@tanstack/react-query';
import WorkflowGraph from '../workflowGraph/WorkflowGraph';
import NodePanel from '../panels/NodePanel';
import FlowHeader from '../components/FlowHeader';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/constants/queryKeys';
import type { FlowData, Node } from '@/types/flow';
import { useFlowMutation } from '../mutations/useFlowMutation';
import { useFlowData } from './hooks/useFlowData';
import { useFlowEvents } from './hooks/useFlowEvents';
import { fanoutProgressOf } from './fanoutProgress';

/**
 * The flow cockpit's client island (§2.1 server/client split): the server page
 * resolves the flow and hydrates this island through `useFlowData`'s
 * `initialData`; everything live — the event stream and the node panels (each
 * resolving its own chat rail, per the panels' workspace factory) — stays
 * client-side on TanStack Query. The cockpit is layout and the flow-wide
 * shared props only — the flow state, the event stream and the action
 * transport; nothing node-specific passes through here.
 */
export default function FlowCockpit({
  flowId,
  initialFlow,
}: {
  flowId: string;
  /** the server loader's snapshot — the query's hydration payload */
  initialFlow: FlowData;
}) {
  const queryClient = useQueryClient();
  const flowQuery = useFlowData(flowId, initialFlow);
  // the hydrated payload is authoritative immediately; a refetch failure keeps
  // the last synced state on screen (§2.8 — banner below, not a blank page)
  const flow: FlowData = flowQuery.data ?? initialFlow;
  const { events, caughtUp } = useFlowEvents(flowId);

  // New events after the tail snapshot — refresh flow detail once per new tail id (CR-119).
  const lastEventId = events.at(-1)?.id;
  useEffect(() => {
    if (!caughtUp || lastEventId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
  }, [queryClient, flowId, caughtUp, lastEventId]);

  // default selection = the first node in graph order (the flow's entry) —
  // nodes arrive pre-sorted; the user picks from there
  //
  // empty `selected` follows current_node; once the user clicks a node, `selected`
  // holds that key so polling doesn't yank the view back to whatever is running
  const [selected, setSelected] = useState('');
  const resolvedSelectedKey = resolveCockpitSelectedKey(selected, flow.current_node);

  const node = useMemo(
    () => flow.nodes.find((n: Node) => n.node_key === resolvedSelectedKey) ?? flow.nodes[0],
    [flow.nodes, resolvedSelectedKey]
  );

  const flowAction = useFlowMutation({ flowId });
  const action = useCallback(
    (act: string, body?: Record<string, unknown>) => {
      flowAction.mutate({ action: act, ...body });
    },
    [flowAction],
  );
  const actionAsync = useCallback(
    (act: string, body?: Record<string, unknown>) =>
      flowAction.mutateAsync({ action: act, ...body }),
    [flowAction],
  );
  const resetAction = useCallback(() => {
    flowAction.reset();
  }, [flowAction]);
  const retryAction = useCallback(() => {
    if (flowAction.variables) {
      flowAction.mutate(flowAction.variables);
      return;
    }
    flowAction.reset();
  }, [flowAction]);

  // plan fan-out: per-node step rollup for the graph subtitle (plain compute —
  // it derives straight from the attached plan-step state)
  const fanout = useMemo(() => fanoutProgressOf(flow), [flow]);

  return (
    <main className="flex flex-col h-screen">
      {/* header */}
      <FlowHeader flow={flow} />

      {flowQuery.isError && (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5"
        >
          <span className="flex-1 text-[12px] text-destructive">
            Lost the connection to this flow — showing the last synced state.
          </span>
          <Button size="sm" variant="outline" onClick={() => void flowQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* workflow graph */}
      <div className="border-b border-border bg-background px-3 py-2.5 overflow-x-auto">
        <WorkflowGraph
          flowId={flow.id}
          nodes={flow.nodes}
          selected={node?.node_key ?? ''}
          onSelect={setSelected}
          currentNode={flow.current_node}
          fanout={fanout}
        />
      </div>

      {/* the selected node's workspace: its panel + capability-driven chat rail */}
      <section className="flex-1 flex flex-col min-h-0">
        {node && (
          <NodePanel
            key={node.node_key}
            flow={flow}
            node={node}
            action={action}
            actionAsync={actionAsync}
            actionPending={flowAction.isPending}
            actionError={flowAction.error}
            resetAction={resetAction}
            retryAction={retryAction}
            events={events}
          />
        )}
      </section>
    </main>
  );
}
