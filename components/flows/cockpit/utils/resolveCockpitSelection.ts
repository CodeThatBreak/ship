import { FLOW_STATUS } from "@/constants/flow";
import type { Node } from "@/types/flow";

/**
 * Every running node key — the graph highlights all of them (fan-out flows
 * may run several nodes at once). Empty set when the flow is idle, which is
 * exactly what a null `current_node` depicted before the column was deleted.
 */
export const runningNodeKeysOf = (nodes: Node[]): Set<string> =>
  new Set(
    nodes
      .filter((n) => n.status === FLOW_STATUS.RUNNING)
      .map((n) => n.node_key),
  );

/**
 * Cockpit graph selection: follow the first running node (the payload arrives
 * pre-sorted in graph order, so "first" is the entry-side one) until the user
 * picks a node.
 */
export const resolveCockpitSelectedKey = (selected: string, nodes: Node[]): string =>
  selected || nodes.find((n) => n.status === FLOW_STATUS.RUNNING)?.node_key || "";
