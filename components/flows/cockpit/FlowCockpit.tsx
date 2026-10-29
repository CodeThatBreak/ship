'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import WorkflowGraph from '../workflow-graph/WorkflowGraph';
import NodePanel from '../panels/NodePanel';
import FlowHeader from '../FlowHeader';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/constants/query-keys';
import { postJson } from '@/hooks/fetch-json';
import type { FlowData, Node } from '@/types/flow';
import { useFlowData } from './hooks/use-flow-data';
import { useFlowEvents } from './hooks/use-flow-events';
import { fanoutProgressOf } from './fanout-progress';

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
  const events = useFlowEvents(flowId);

  // a new event batch = state a flow refetch hasn't seen yet — refresh it once
  // per batch (the old page called loadFlow() straight from the poll loop)
  const lastEventId = events.at(-1)?.id;
  useEffect(() => {
    if (lastEventId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
  }, [queryClient, flowId, lastEventId]);

  // default selection = the first node in graph order (the flow's entry) —
  // nodes arrive pre-sorted; the user picks from there
  //
  // once the user clicks a node we stop auto-following current_node, so polling
  // doesn't yank the view back to whatever happens to be running
  const userSelected = useRef(false);
  const [selected, setSelected] = useState('');
  const resolvedSelectedKey = userSelected.current ? selected : (flow.current_node ?? '');
  const onSelect = useCallback((key: string) => {
    userSelected.current = true;
    setSelected(key);
  }, []);

  const node = useMemo(
    () => flow.nodes.find((n: Node) => n.node_key === resolvedSelectedKey) ?? flow.nodes[0],
    [flow.nodes, resolvedSelectedKey]
  );

  const action = useCallback(
    async (act: string, body?: Record<string, unknown>) => {
      await postJson(`/api/flows/${flowId}/action`, JSON.stringify({ action: act, ...body }));
      // the action changed flow state — refresh the cockpit's snapshot
      await queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
    },
    [flowId, queryClient]
  );

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
          onSelect={onSelect}
          currentNode={flow.current_node}
          fanout={fanout}
        />
      </div>

      {/* the selected node's workspace: its panel + capability-driven chat rail */}
      <section className="flex-1 flex flex-col min-h-0">
        {node && <NodePanel flow={flow} node={node} action={action} events={events} />}
      </section>
    </main>
  );
}
