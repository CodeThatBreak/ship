"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import WorkflowGraph from "../workflow-graph/WorkflowGraph";
import NodePanel from "../panels/NodePanel";
import {
  ChatPanel,
  type PlanOptions,
  type PlanStartOpts,
} from "@/components/chat";
import FlowHeader from "../FlowHeader";
import { Button } from "@/components/ui/button";
// value from lib/modelSpec (pure helpers, Phase 0 allowlist); the types flow
// through types/model-spec per the Phase 0 guidance
import { composeModelChoice } from "@/lib/modelSpec";
import type { ModelChoice } from "@/types/model-spec";
import { queryKeys } from "@/constants/query-keys";
import { FLOW_STATUS } from "@/constants/flow";
import type { FlowData, Node } from "@/types/flow";
import { useFlowData } from "./hooks/use-flow-data";
import { useFlowEvents } from "./hooks/use-flow-events";
import { fanoutProgressOf } from "./fanout-progress";

/**
 * The flow cockpit's client island (§2.1 server/client split): the server page
 * resolves the flow and hydrates this island through `useFlowData`'s
 * `initialData`; everything live — the event stream, chat, node panels and
 * their Poller-driven refreshes — stays client-side on TanStack Query
 * (`components/flows/panels` registry and the chat/feedback hooks are reused as-is).
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
  const [selected, setSelected] = useState("");
  const resolvedSelectedKey = userSelected.current ? selected : flow.current_node ?? "";
  const onSelect = useCallback((key: string) => {
    userSelected.current = true;
    setSelected(key);
  }, []);

  const node = useMemo(
    () => flow.nodes.find((n: Node) => n.node_key === resolvedSelectedKey) ?? flow.nodes[0],
    [flow.nodes, resolvedSelectedKey],
  );
  // the prompt preview box sits over the chat: prompt-publishing nodes (the
  // plan, §3.2 capabilities) before their first run — nothing to chat with yet
  const promptPending =
    Boolean(node?.capabilities?.promptNode) &&
    (node?.artifacts.length ?? 0) === 0 &&
    node?.status === FLOW_STATUS.PENDING;

  // one model override for this flow's runs — picked in the chat panel's
  // model selector, consumed by every run-start action below
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  const model = composeModelChoice(modelChoice);

  // plan-generation options — toggled via the icon buttons in the chat panel's
  // prompt box / input row, part of the plan node's contract input
  const [planOptions, setPlanOptions] = useState<PlanOptions>({ decompose: false, complex: false });

  const action = useCallback(
    async (act: string, body?: Record<string, unknown>) => {
      await fetch(`/api/flows/${flowId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act, ...body }),
      });
      // the action changed flow state — refresh the cockpit's snapshot
      await queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
    },
    [flowId, queryClient],
  );

  // start the node's first run from the chat's prompt box / prompt modal —
  // the generic run_node action with the node's contract input (the plan
  // node's contract carries prompt/promptIsBody/decompose/complex/model)
  const startNode = useCallback(
    (opts?: PlanStartOpts) => {
      const nodeKey = node?.node_key;
      if (!nodeKey) return;
      return action("run_node", {
        nodeKey,
        input: {
          prompt: opts?.prompt ?? null,
          promptIsBody: opts?.promptIsBody ?? false,
          decompose: planOptions.decompose,
          complex: planOptions.complex,
          model: model || null,
        },
      });
    },
    [action, node, planOptions.decompose, planOptions.complex, model],
  );

  // node id → node key, for the chat feed's run-section grouping
  const nodeKeysByNodeId = useMemo(
    () => new Map(flow.nodes.map((n) => [n.id, n.node_key])),
    [flow.nodes],
  );
  // node id → status, for the chat panel to close stale "running" sections
  const nodeStatusByNodeId = useMemo(
    () => new Map(flow.nodes.map((n) => [n.id, n.status])),
    [flow.nodes],
  );

  // busy for the chat panel = this node's agent is running (not just any node)
  const busy = flow.current_node === node?.node_key;

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
          selected={node?.node_key ?? ""}
          onSelect={onSelect}
          currentNode={flow.current_node}
          fanout={fanout}
        />
      </div>

      {/* main split: node panel + right rail */}
      <div className="flex flex-1 min-h-0">
        <section className="flex-[1.6] border-r border-border flex flex-col min-h-0 min-w-0">
          {node && (
            <NodePanel
              flow={flow}
              node={node}
              action={action}
              events={events}
              model={model}
              planOptions={planOptions}
            />
          )}
        </section>
        <aside className="flex-1 flex flex-col bg-card min-w-[340px] p-3.5">
          <ChatPanel
            flowId={flow.id}
            nodeKey={node?.node_key ?? ""}
            nodeLabel={node?.label ?? node?.template_name ?? node?.node_key ?? ""}
            capabilities={node?.capabilities ?? null}
            busy={busy}
            canRefine={Boolean(node?.artifacts.length)}
            events={events}
            nodeKeysByNodeId={nodeKeysByNodeId}
            nodeStatusByNodeId={nodeStatusByNodeId}
            modelChoice={modelChoice}
            setModelChoice={setModelChoice}
            showPromptBox={promptPending}
            planOptions={planOptions}
            setPlanOptions={setPlanOptions}
            onStartNode={startNode}
          />
        </aside>
      </div>
    </main>
  );
}
