"use client";
import { useMemo } from "react";
import { useNodePanel } from "../context";

/**
 * The chat rail's bindings to the selected node, derived from the panel
 * context: whether this node's agent is the one running (the feed's
 * awaiting-reply state) and the feed's run-section grouping maps. Shared by
 * `NodeChat` (the standard rail) and the plan feature's `PlanNodeChat`.
 */
export function useNodeChatBindings(): {
  busy: boolean;
  nodeKeysByNodeId: Map<string, string>;
  nodeStatusByNodeId: Map<string, string>;
} {
  const { flow, node } = useNodePanel();

  return {
    // busy for the chat panel = this node's agent is running (not just any node)
    busy: flow.current_node === node.node_key,
    // node id → node key, for the chat feed's run-section grouping
    nodeKeysByNodeId: useMemo(
      () => new Map(flow.nodes.map((n) => [n.id, n.node_key])),
      [flow.nodes],
    ),
    // node id → status; acts as the authority on whether a run is really
    // running, since a run's "finished" event can fall outside the fetched
    // event window
    nodeStatusByNodeId: useMemo(
      () => new Map(flow.nodes.map((n) => [n.id, n.status])),
      [flow.nodes],
    ),
  };
}
