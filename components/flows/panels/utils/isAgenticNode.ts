import type { Node } from "@/types/flow";

/**
 * An agentic node runs an agent and owns a chat rail — the node contract
 * advertises that with `capabilities.refinable` (the same flag the panel
 * factory uses to mount a chat rail). Its running state belongs in ChatPanel,
 * not in a second centered "agent is working" block in the panel body.
 */
export function isAgenticNode(node: Node): boolean {
  return node.capabilities?.refinable === true;
}
